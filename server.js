// server.js
// This file sets up an Express server to handle audio transcription
// and AI answering using OpenAI's Whisper and GPT models.

require('dotenv').config(); // Load environment variables from a .env file

const express = require('express');
const multer = require('multer'); // Middleware for handling `multipart/form-data` (file uploads)
const fetch = require('node-fetch'); // Used to make HTTP requests to OpenAI APIs
const cors = require('cors'); // Middleware to enable Cross-Origin Resource Sharing

const app = express();
// Use the PORT environment variable provided by Render, or default to 3000 for local development
const port = process.env.PORT || 3000;

// Configure CORS
// IMPORTANT: In production, replace '*' with the specific origin(s) of your Chrome extension
// (e.g., 'chrome-extension://YOUR_EXTENSION_ID') and your frontend web app URL
// (e.g., 'https://your-frontend-app.onrender.com').
// For development and initial testing, '*' is convenient but less secure.
app.use(cors({
    origin: '*', // Allows all origins for now. Be specific in production!
    methods: ['GET', 'POST'], // Allow GET and POST requests
    allowedHeaders: ['Content-Type', 'Authorization'] // Allow these headers
}));

// Multer storage configuration: store uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });

// A simple in-memory store for the latest Q&A,
// so the frontend can fetch it if it's a separate static site.
// In a production app, you might use a database (like Redis or Firestore) for persistence.
let latestQA = { transcript: 'No transcript yet.', answer: 'No AI answer yet.' };

// Define the API endpoint for transcribing audio and getting an AI answer
// This endpoint expects a POST request with an audio file named 'audio'.
app.post('/transcribe-and-answer', upload.single('audio'), async (req, res) => {
    // Retrieve the OpenAI API Key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;

    // Check if API Key is configured
    if (!apiKey) {
        console.error('OpenAI API Key is not configured in environment variables.');
        return res.status(500).json({ error: 'Server error: OpenAI API Key not configured.' });
    }

    // Check if an audio file was uploaded
    if (!req.file) {
        console.error('No audio file provided in the request.');
        return res.status(400).json({ error: 'No audio file provided.' });
    }

    try {
        // --- Step 1: Send audio to OpenAI Whisper API for transcription ---
        const whisperForm = new FormData();
        // Create a Blob from the audio buffer received from Multer
        const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
        // Append the audio file with its original name and mimetype
        whisperForm.append('file', audioBlob, req.file.originalname || 'audio.webm');
        whisperForm.append('model', 'whisper-1'); // Specify the Whisper model

        console.log('Sending audio to Whisper API...');
        const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { 'Authorization': `Bearer ${apiKey}` }, // Authenticate with OpenAI API Key
            body: whisperForm, // Send the FormData
        });

        // Handle non-OK responses from Whisper API
        if (!whisperRes.ok) {
            const errorData = await whisperRes.json();
            console.error('Whisper API Error:', errorData);
            return res.status(whisperRes.status).json({
                error: `Whisper API error: ${errorData.error?.message || whisperRes.statusText}`
            });
        }

        const whisperData = await whisperRes.json();
        const transcript = whisperData.text || "No transcript generated.";
        console.log('Transcript received:', transcript);

        // --- Step 2: Send transcript to OpenAI GPT API for answering ---
        console.log('Sending transcript to GPT API...');
        const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`, // Authenticate with OpenAI API Key
            },
            body: JSON.stringify({
                model: "gpt-4o", // Specify the GPT model (or another suitable model)
                messages: [{ role: "user", content: transcript }], // Send the transcript as a user message
            }),
        });

        // Handle non-OK responses from GPT API
        if (!gptRes.ok) {
            const errorData = await gptRes.json();
            console.error('GPT API Error:', errorData);
            return res.status(gptRes.status).json({
                error: `GPT API error: ${errorData.error?.message || gptRes.statusText}`
            });
        }

        const gptData = await gptRes.json();
        const answer = gptData.choices?.[0]?.message?.content || "No answer.";
        console.log('AI Answer received:', answer);

        // Store the latest Q&A for the frontend to fetch (optional, for static frontend)
        latestQA = { transcript, answer };

        // Send the transcription and answer back to the Chrome extension
        res.json({ transcript, answer });

    } catch (error) {
        console.error('Caught server-side error:', error);
        res.status(500).json({ error: 'Internal server error during processing.' });
    }
});

// Optional: Endpoint for the frontend to fetch the latest Q&A
// This is useful if your frontend is a separate static site that needs to poll for updates.
app.get('/latest-qa', (req, res) => {
    res.json(latestQA);
});

// Start the server and listen for incoming requests
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
