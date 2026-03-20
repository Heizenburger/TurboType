require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('./models/User'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize Gemini using the secure environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

// Safely point to the public folder
app.use(express.static(path.join(__dirname, 'public'))); 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));


// --- AUTHENTICATION API ENDPOINTS ---
app.post('/api/register', async (req, res) => {
    try {
        const { email, gamertag, password, avatar } = req.body;
        const existingUser = await User.findOne({ $or: [{ email }, { gamertag }] });
        if (existingUser) return res.status(400).json({ error: "Email or Gamertag already in use." });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ email, gamertag, password: hashedPassword, avatar });
        await newUser.save();

        res.status(201).json({ message: "Account created successfully!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error during registration." });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { loginIdentifier, password } = req.body;
        const user = await User.findOne({ $or: [{ email: loginIdentifier }, { gamertag: loginIdentifier }] });

        if (!user) return res.status(400).json({ error: "Invalid credentials." });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: "Invalid credentials." });

        const token = jwt.sign({ id: user._id, gamertag: user.gamertag, avatar: user.avatar }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, gamertag: user.gamertag, avatar: user.avatar });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error during login." });
    }
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token." });
        req.user = user; 
        next();
    });
}

// --- PROTECTED ACCOUNT ENDPOINTS ---
app.get('/api/account', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ error: "User not found." });
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error fetching account data." });
    }
});

app.put('/api/account/update', authenticateToken, async (req, res) => {
    try {
        const { gamertag, password } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found." });

        if (gamertag && gamertag !== user.gamertag) {
            const existingTag = await User.findOne({ gamertag });
            if (existingTag) return res.status(400).json({ error: "Gamertag is already taken." });
            user.gamertag = gamertag;
        }

        if (password && password.trim().length > 0) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();
        res.json({ message: "Profile updated successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error updating profile." });
    }
});

app.post('/api/game/end', authenticateToken, async (req, res) => {
    try {
        const { gameMode, wpm, accuracy, burstSpeed, score } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const totalGames = 
    user.games.turboRacing.played + 
    user.games.samuraiTyping.played + 
    user.games.syntaxArena.played + 
    user.games.colosseumRaid.played + 1;
        user.globalMetrics.avgWpm = Math.round(((user.globalMetrics.avgWpm * (totalGames - 1)) + wpm) / totalGames);
        user.globalMetrics.avgAccuracy = Math.round(((user.globalMetrics.avgAccuracy * (totalGames - 1)) + accuracy) / totalGames);
        if (burstSpeed > user.globalMetrics.peakBurstSpeed) user.globalMetrics.peakBurstSpeed = Math.round(burstSpeed);

        if (gameMode === 'turboRacing') {
            user.games.turboRacing.played += 1;
            if (score === 1) user.games.turboRacing.wins += 1;
        } else if (gameMode === 'samuraiTyping') {
            user.games.samuraiTyping.played += 1;
            if (score > user.games.samuraiTyping.highestWave) user.games.samuraiTyping.highestWave = score;
        } else if (gameMode === 'syntaxArena') {
            user.games.syntaxArena.played += 1;
            if (score === 1) user.games.syntaxArena.wins += 1; 
        } else if (gameMode === 'colosseumRaid') {
            user.games.colosseumRaid.played += 1;
            user.games.colosseumRaid.totalDamage += score; 
        }

        let wpmScore = Math.min((user.globalMetrics.avgWpm / 150) * 400, 400);
        let accScore = (user.globalMetrics.avgAccuracy / 100) * 400;
        let burstScore = Math.min((user.globalMetrics.peakBurstSpeed / 200) * 200, 200);
        user.skillScore = Math.round(wpmScore + accScore + burstScore);

        await user.save();
        res.json({ message: "Stats saved successfully", newSkillScore: user.skillScore });
    } catch (error) {
        console.error("Error saving game stats:", error);
        res.status(500).json({ error: "Server error saving game stats." });
    }
});

app.get('/api/leaderboards', async (req, res) => {
    try {
        const topPlayers = await User.find().sort({ skillScore: -1 }).limit(10).select('gamertag avatar skillScore games'); 
        res.json(topPlayers);
    } catch (error) {
        console.error("Leaderboard fetch error:", error);
        res.status(500).json({ error: "Server error fetching leaderboards." });
    }
});


// --- UNIFIED ROOM ARCHITECTURE ---
const activeRooms = {};
const BOSS_MAX_HP = 5000;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase(); 
}

async function generateTypingText(difficultyLevel, lengthLevel) {
    let wordCount = 50; 
    if (lengthLevel === 1) wordCount = 20;       
    else if (lengthLevel === 2) wordCount = 50;  
    else if (lengthLevel === 3) wordCount = 120; 

    let prompt = "";
    if (difficultyLevel === 1) prompt = `Generate a text containing exactly ${wordCount} words. USE ONLY extremely simple, 3-to-4 letter words (like cat, dog, run, the, sun). DO NOT use any punctuation marks whatsoever (no commas, no periods). DO NOT use any capital letters. DO NOT use numbers. The output MUST be 100% lowercase plain text consisting only of easy words.`;
    else if (difficultyLevel === 2) prompt = `Write a standard ${wordCount}-word paragraph about technology or racing. Use normal sentence structure, basic punctuation (commas, periods), and standard capitalization.`;
    else prompt = `Write a highly complex ${wordCount}-word paragraph for an advanced typing test. Include difficult vocabulary, frequent numbers, and special characters like parentheses (), quotes, semicolons, and hyphens.`;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/\n/g, ' ').trim();
        
        // Hard enforce Easy Mode rules in case AI hallucinates punctuation
        if (difficultyLevel === 1) {
            text = text.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
        }
        return text;
    } catch (error) {
        return "fallback text because the api failed typing speed is a fundamental skill";
    }
}

async function generateSyntaxSnippet(skillCeiling, language) {
    let prompt = "";
    const langStr = language || "JavaScript"; // Default fallback
    
    // SCALE DIFFICULTY BASED ON ROOM'S HIGHEST SKILL SCORE
    if (skillCeiling < 200) {
        prompt = `Write a simple 4 to 5 line ${langStr} code snippet demonstrating basic variable assignments and print statements. Do not include comments or markdown formatting. Output raw code only.`;
    } else if (skillCeiling < 600) {
        prompt = `Write a 6 to 8 line ${langStr} code snippet demonstrating a for-loop, standard functions, and basic arrays. Do not include comments or markdown formatting. Output raw code only.`;
    } else {
        prompt = `Write an advanced 8 to 10 line ${langStr} code snippet demonstrating complex object-oriented structures, asynchronous logic, or pointer arithmetic (depending on the language). Use precise syntax. Do not include comments or markdown formatting. Output raw code only.`;
    }

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        // Clean up markdown code block fences if AI includes them
        text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
        return text;
    } catch (error) {
        return `function fallback() {\n  return "AI Generation Failed";\n}`; 
    }
}

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

// 7. SYNTAX ARENA PHYSICS LOOP (30 FPS)
setInterval(() => {
    for (const roomCode in activeRooms) {
        const room = activeRooms[roomCode];
        if (room.gameMode === 'syntaxArena' && room.status === 'playing') {
            // Broadcast exact core position to clients
            io.to(roomCode).emit('syntaxCoreUpdate', { corePosition: room.corePosition });
            
            // Evaluate Match Win Condition
            if (room.corePosition <= -100 || room.corePosition >= 100) {
                room.status = 'finished';
                const winnerDirection = room.corePosition <= -100 ? -1 : 1;
                const winner = Object.values(room.players).find(p => p.tugDirection === winnerDirection);
                
                io.to(roomCode).emit('syntaxMatchEnded', { winner: winner ? winner.name : 'Unknown' });
            }
        }
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
