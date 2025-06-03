# DickinsonQA

## Description

**DickinsonQA** is a web application designed to help students and other members of Dickinson College quickly find answers to questions about institutional policies. It features a chat-like interface and leverages the **Perplexity API** to understand user queries and provide relevant responses based on the college’s official policy documents.

The app uses a **separated frontend and backend** architecture:

- **Frontend**: HTML, Tailwind CSS, and JavaScript
- **Backend**: Node.js and Express.js

## Technologies Used

### Frontend
- HTML5  
- Tailwind CSS  
- JavaScript  
- Marked.js  

### Backend
- Node.js  
- Express.js  

### API
- Perplexity API

## Setup and Installation

### Prerequisites

- Node.js and npm installed
- A Perplexity API key

### Backend Setup

1. **Clone the repository:**

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
cd YOUR_REPOSITORY_NAME
```
2. **Install Dependencies:**

```bash
npm install
```
3. **Create a ```.env```file:**
Add your Perplexity API key:

```
PERPLEXITY_API_KEY=your_actual_perplexity_api_key_here
```
### How to Run
1. **Start Server:**

```bash
node server.js
```
2. **Open the Frontend:**
Open index.html directly in your browser.
Start asking questions in the chat interface!

## Customization for your College
To make this app work specifically for your college, update the ```system``` message prompt in ```server.js```:

```javascript
// Inside server.js, in the requestBodyToPerplexity object:
messages: [
           { role: "system", 
             // change this content:
             content: "You are a helpful assistant that answers questions about [your college]. Answer as accurately and concisely as possible. If an answer is unclear or unavailable, say so honestly."},
           { role: "user", content: userQuestion }
            ],
            search_domain_filter: ["yourcollege.edu"],
```

## Future Improvements
* User authentication for restricted content access
* Admin panel for managing sources or tuning prompts
* Conversation history with a database
* Feedback/rating system for answers
* Improved error handling and UI feedback