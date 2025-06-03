
const express = require('express');
const fetch = require('node-fetch'); // Ensure node-fetch@2
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

if (!PERPLEXITY_API_KEY) {
    console.error("FATAL ERROR: PERPLEXITY_API_KEY is not set.");
}

function sendSseToFrontend(res, eventName, data) {
    if (res.writableEnded) {
        // console.warn(`Backend: Attempted to write SSE (${eventName}) to frontend but stream was already ended.`);
        return;
    }
    try {
        const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(message);
        // console.log(`Backend: >>> Sent to Frontend >>> event: ${eventName}, data: ${JSON.stringify(data).substring(0, 70)}...`);
    } catch (error) {
        console.error(`Backend: Error writing SSE (${eventName}) to frontend:`, error);
    }
}

app.post('/api/ask', async (req, res) => {
    const userQuestion = req.body.question;
    if (!userQuestion) return res.status(400).json({ error: 'Question required.' });
    if (!PERPLEXITY_API_KEY) return res.status(500).json({ error: 'API Key not configured.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    // console.log("Backend: SSE headers sent to frontend.");

    try {
        const requestBodyToPerplexity = {
            model: "sonar",
            messages: [
                { role: "system", content: "You are a helpful assistant that answers questions about Dickinson College. Answer as accurately and concisely as possible. If an answer is unclear or unavailable, say so honestly."},
                { role: "user", content: userQuestion }
            ],
            stream: true,
            search_domain_filter: ["dickinson.edu"], 
            max_tokens: 512,
        };
        console.log("Backend: Request:\n" + userQuestion + "\n----------------------------------------------------------------------\n")

        const perplexityResponse = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(requestBodyToPerplexity)
        });

        if (!perplexityResponse.ok) {
            const errorText = await perplexityResponse.text();
            console.error('Backend: Perplexity API Error (pre-stream):', perplexityResponse.status, errorText);
            sendSseToFrontend(res, 'error', { message: `Perplexity API Error (${perplexityResponse.status}): ${errorText}` });
            if (!res.writableEnded) res.end();
            return;
        }
        // console.log("Backend: Connection to Perplexity successful, stream starting.");

        const decoder = new TextDecoder();
        let lineBufferFromPerplexity = '';
        let accumulatedCitations = [];
        let streamSignaledDoneByPerplexity = false;
        let hasSentAnyDeltaContent = false; // Flag to track if deltas were sent

        perplexityResponse.body.on('data', (rawChunkFromPerplexity) => {
            const decodedChunk = decoder.decode(rawChunkFromPerplexity, { stream: true });
            lineBufferFromPerplexity += decodedChunk;

            let newlineIndex;
            while ((newlineIndex = lineBufferFromPerplexity.indexOf('\n')) >= 0) {
                const line = lineBufferFromPerplexity.substring(0, newlineIndex).trim();
                lineBufferFromPerplexity = lineBufferFromPerplexity.substring(newlineIndex + 1);

                if (!line) continue;

                if (line.startsWith('data: ')) {
                    const jsonDataString = line.substring(6).trim();
                    if (jsonDataString === '[DONE]') {
                        // console.log('Backend: Perplexity stream indicated [DONE]');
                        streamSignaledDoneByPerplexity = true;
                        sendSseToFrontend(res, 'done', { citations: accumulatedCitations, source: '[DONE]' });
                        return;
                    }
                    try {
                        const parsedEventDataFromPerplexity = JSON.parse(jsonDataString);

                        if (parsedEventDataFromPerplexity.choices && parsedEventDataFromPerplexity.choices[0]) {
                            const choice = parsedEventDataFromPerplexity.choices[0];
                            let contentToRelay = null;

                            // Prioritize delta content if available and non-empty
                            if (choice.delta && choice.delta.content && choice.delta.content.length > 0) {
                                contentToRelay = choice.delta.content;
                                hasSentAnyDeltaContent = true; // Mark that we've sent actual delta content
                            } 
                            // If it's a final message with full content
                            else if (choice.message && choice.message.content && choice.finish_reason === 'stop') {
                                // Only send this full content if NO deltas were previously sent for this response.
                                // This prevents sending the aggregated message if the frontend already built it.
                                if (!hasSentAnyDeltaContent) {
                                    contentToRelay = choice.message.content;
                                    // console.log("Backend: Full message content from Perplexity (finish_reason=stop, no prior deltas).");
                                } else {
                                    // console.log("Backend: Full message content from Perplexity (finish_reason=stop) received, but deltas were already sent. Skipping redundant full content send.");
                                }
                                // Always try to grab citations from the final message structure
                                if (parsedEventDataFromPerplexity.citations) {
                                     accumulatedCitations = parsedEventDataFromPerplexity.citations;
                                } else if (choice.message.citations) { // Sometimes citations are nested in message
                                     accumulatedCitations = choice.message.citations;
                                }
                            }

                            if (contentToRelay) {
                                sendSseToFrontend(res, 'content', { token: contentToRelay });
                            }

                            if (choice.finish_reason) {
                                // console.log('Backend: Perplexity stream indicates finish_reason:', choice.finish_reason);
                                streamSignaledDoneByPerplexity = true;
                                // Ensure citations are captured if not already
                                if (!accumulatedCitations.length && parsedEventDataFromPerplexity.citations) {
                                    accumulatedCitations = parsedEventDataFromPerplexity.citations;
                                } else if (!accumulatedCitations.length && choice.message && choice.message.citations) {
                                    accumulatedCitations = choice.message.citations;
                                }
                                sendSseToFrontend(res, 'done', { citations: accumulatedCitations, finish_reason: choice.finish_reason });
                                return; 
                            }
                        } else {
                             // console.log("Backend: Parsed Perplexity data, but no choices found as expected:", parsedEventDataFromPerplexity);
                        }
                    } catch (e) {
                        console.error('Backend: Error parsing Perplexity SSE JSON:', e, "Problematic Line:", jsonDataString);
                    }
                } else {
                    // console.log("Backend: Received non-SSE-data line from Perplexity:", line);
                }
            }
        });

        perplexityResponse.body.on('end', () => {
            if (lineBufferFromPerplexity.trim()) {
                console.warn("Backend: Buffer has remaining data at Perplexity stream end:", lineBufferFromPerplexity);
            }
            if (!streamSignaledDoneByPerplexity && !res.writableEnded) {
                 // console.log("Backend: Forcing 'done' to frontend as Perplexity stream ended without explicit signal.");
                 sendSseToFrontend(res, 'done', { citations: accumulatedCitations, source: "perplexity_stream_end_fallback" });
            }
            if (!res.writableEnded) {
                // console.log("Backend: Closing connection to frontend.");
                res.end();
            }
        });

        perplexityResponse.body.on('error', (err) => {
            console.error('Backend: Error in Perplexity response stream (body.on.error):', err);
            if (!res.writableEnded) {
                sendSseToFrontend(res, 'error', { message: 'Error in stream from Perplexity.' });
                res.end();
            }
        });

    } catch (error) {
        console.error('Backend: Error in /api/ask endpoint:', error);
        if (!res.writableEnded) {
            try {
                sendSseToFrontend(res, 'error', { message: `Internal server error: ${error.message}` });
            } finally {
                if (!res.writableEnded) res.end();
            }
        }
    }
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}\n`);
    if (!PERPLEXITY_API_KEY) console.warn("PERPLEXITY_API_KEY not set.");
});
