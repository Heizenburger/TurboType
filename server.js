require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize Gemini (Make sure to set this in your environment variables)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE');
// We use gemini-2.5-flash as it is the fastest model, perfect for real-time game generation
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

app.use(express.static('public')); // Assuming your HTML/JS/CSS are in a 'public' folder

let waitingPlayer = null;

// Helper function to generate text based on difficulty level
async function generateTypingText(difficultyLevel) {
    let prompt = "";
    if (difficultyLevel === 1) {
        prompt = "Write a simple, 30-word paragraph using only easy, common vocabulary. Do not use any punctuation marks or numbers. Just plain lowercase words.";
    } else if (difficultyLevel === 2) {
        prompt = "Write a standard 40-word paragraph about technology or racing. Use normal sentence structure, basic punctuation (commas, periods), and standard capitalization.";
    } else {
        prompt = "Write a highly complex 40-word paragraph for an advanced typing test. Include difficult vocabulary, frequent numbers, and special characters like parentheses (), quotes, semicolons, and hyphens.";
    }

    try {
        const result = await model.generateContent(prompt);
        // Clean up the text (remove newlines, extra spaces, etc.)
        return result.response.text().replace(/\n/g, ' ').trim();
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "Fallback text because the API failed. Typing speed is a fundamental skill in the digital age.";
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinGame', async (data) => {
        const player = {
            id: socket.id,
            name: data.name,
            difficulty: data.difficulty,
            socket: socket
        };

        if (waitingPlayer) {
            // We have a match!
            const p1 = waitingPlayer;
            const p2 = player;
            waitingPlayer = null; // Clear queue

            // 1. Resolve difficulty: Pick the highest (hardest) value between the two players
            const resolvedDifficulty = Math.max(p1.difficulty, p2.difficulty);

            // 2. Generate the paragraph using Gemini
            const generatedText = await generateTypingText(resolvedDifficulty);

            // 3. Send the match data AND the text to both players
            const matchData = {
                players: [
                    { id: p1.id, name: p1.name },
                    { id: p2.id, name: p2.name }
                ],
                text: generatedText
            };

            p1.socket.emit('matchFound', matchData);
            p2.socket.emit('matchFound', matchData);
            
            // Set up progress syncing between these two specific players
            p1.socket.on('updateProgress', (progressData) => p2.socket.emit('opponentProgress', progressData));
            p2.socket.on('updateProgress', (progressData) => p1.socket.emit('opponentProgress', progressData));

        } else {
            // Nobody is waiting, put this player in the queue
            waitingPlayer = player;
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});