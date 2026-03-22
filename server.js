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

// AI Initialization (Correctly ordered!)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" }); 

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
        res.status(500).json({ error: "Server error during login." });
    }
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) return res.status(401).json({ error: "Access denied." });

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
        res.status(500).json({ error: "Server error updating profile." });
    }
});

app.post('/api/game/end', authenticateToken, async (req, res) => {
    try {
        const { gameMode, wpm, accuracy, burstSpeed, score } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const totalGames = user.games.turboRacing.played + user.games.samuraiTyping.played + user.games.syntaxArena.played + user.games.colosseumRaid.played + 1;
            
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
        res.status(500).json({ error: "Server error saving game stats." });
    }
});

app.get('/api/leaderboards', async (req, res) => {
    try {
        const topPlayers = await User.find().sort({ skillScore: -1 }).limit(10).select('gamertag avatar skillScore games'); 
        res.json(topPlayers);
    } catch (error) {
        res.status(500).json({ error: "Server error fetching leaderboards." });
    }
});


// --- UNIFIED ROOM ARCHITECTURE & AI GENERATORS ---
const activeRooms = {};
const BOSS_MAX_HP = 5000;
let waitingPlayer = null; 

function generateRoomCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

// --- AI GENERATORS WITH OFFLINE FALLBACKS ---
async function generateTypingText(difficultyLevel, lengthLevel = 2) {
    let wordCount = 50; 
    if (lengthLevel === 1) wordCount = 20;       
    else if (lengthLevel === 2) wordCount = 50;  
    else if (lengthLevel === 3) wordCount = 120; 

    const seed = Math.floor(Math.random() * 100000);
    let prompt = "";
    
    if (difficultyLevel === 1) prompt = `Task [${seed}]: Generate a text containing exactly ${wordCount} words. USE ONLY extremely simple, 3-to-4 letter words. DO NOT use any punctuation marks whatsoever. The output MUST be 100% lowercase plain text consisting only of easy words.`;
    else if (difficultyLevel === 2) prompt = `Task [${seed}]: Write a standard ${wordCount}-word paragraph about technology or racing. Use normal sentence structure, basic punctuation (commas, periods), and standard capitalization.`;
    else prompt = `Task [${seed}]: Write an epic, dark-fantasy ${wordCount}-word paragraph for a boss battle. Include difficult vocabulary, hyphenated words, and dramatic punctuation like quotes and semicolons.`;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/\n/g, ' ').trim();
        if (difficultyLevel === 1) text = text.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
        return text;
    } catch (error) {
        console.error("Typing AI Rate Limit Hit - Using Fallback.");
        
        const easyBackups = [
            "the cat ran fast and the dog sat down on the rug to nap in the sun",
            "you can win this race if you try hard and type fast with no bad keys",
            "red car blue car one two go run far out and get the top spot now"
        ];
        const hardBackups = [
            "The ancient behemoth roared, sending shockwaves through the shattered colosseum! Knights raised their shields, bracing against the devastating hellfire.",
            "Navigating the corrupted mainframe, the rogue AI deployed a multi-threaded payload. 'Access Denied,' the terminal flashed, locking the encrypted data.",
            "Dark matter pulsed within the alien dreadnought. Antimatter cannons charged to maximum capacity, threatening to obliterate the fragile human resistance!"
        ];
        
        const backupArray = difficultyLevel === 1 ? easyBackups : hardBackups;
        return backupArray[Math.floor(Math.random() * backupArray.length)];
    }
}

async function generateSyntaxSnippet(language) {
    const langStr = language || "JavaScript";
    const seed = Math.floor(Math.random() * 100000);
    
    const prompt = `Task [${seed}]: Write a highly complex 6 to 8 line ${langStr} code snippet demonstrating arrays, loops, or functions. Do not include comments or markdown formatting. Output raw code only.`;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    } catch (error) {
        console.error("Syntax AI Rate Limit Hit - Using Fallback.");
        const fallbacks = [
`function calculateTrajectory(velocity, angle) {
  const gravity = 9.81;
  const rad = angle * (Math.PI / 180);
  let distance = (Math.pow(velocity, 2) * Math.sin(2 * rad)) / gravity;
  return parseFloat(distance.toFixed(2));
}`,
`const dataStream = [0x4A, 0x1F, 0x8C, 0x3B];
let decryptedPayload = dataStream.map(byte => {
  let shift = (byte << 2) & 0xFF;
  return shift ^ 0xAA;
});
console.log(decryptedPayload);`,
`class CyberNode {
  constructor(ip, firewall) {
    this.ip = ip;
    this.firewall = firewall;
  }
  breach(attackPower) {
    return attackPower > this.firewall;
  }
}`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

// --- SOCKET.IO MULTIPLAYER LOGIC ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', async (data) => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = {
            roomCode: roomCode,
            gameMode: data.gameMode || 'turboRacing',
            language: data.language || 'JavaScript', 
            status: 'waiting',
            players: { [socket.id]: { id: socket.id, name: data.name, progress: 0, wpm: 0 } },
            rematchVoters: new Set()
        };

        if (data.gameMode === 'colosseumRaid') {
            const loreText = await generateTypingText(3, 3);
            activeRooms[roomCode].boss = { maxHp: BOSS_MAX_HP, hp: BOSS_MAX_HP, activeLore: loreText };
        }

        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode: roomCode, boss: activeRooms[roomCode].boss });
    });

    socket.on('joinRoom', async (data) => {
        const room = activeRooms[data.roomCode];
        if (!room) return socket.emit('roomError', 'Room not found.');
        
        room.players[socket.id] = { id: socket.id, name: data.name, progress: 0, wpm: 0 };
        socket.join(data.roomCode);

        if (room.gameMode === 'turboRacing' && Object.keys(room.players).length === 2) {
            room.status = 'playing';
            const text = await generateTypingText(2, 2);
            io.to(data.roomCode).emit('matchStart', { players: room.players, text: text });
            
        } else if (room.gameMode === 'colosseumRaid') {
            socket.emit('raidState', { roomCode: data.roomCode, boss: room.boss, players: room.players });
            socket.to(data.roomCode).emit('playerJoinedRaid', { id: socket.id, name: data.name });
            
        } else if (room.gameMode === 'syntaxArena' && Object.keys(room.players).length === 2) {
            room.status = 'playing';
            room.corePosition = 0;
            
            const pIds = Object.keys(room.players);
            room.players[pIds[0]].tugDirection = -1;
            room.players[pIds[1]].tugDirection = 1;

            const snippet = await generateSyntaxSnippet(room.language);
            io.to(data.roomCode).emit('syntaxMatchFound', { players: room.players, snippet: snippet, selectedLanguage: room.language });
        }
    });

    socket.on('updateProgress', (data) => socket.to(data.roomCode).emit('opponentProgress', data));

    socket.on('syntaxKeystroke', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.status === 'playing') {
            const player = room.players[socket.id]; 
            if (player) room.corePosition += (player.tugDirection * 2.5); 
        }
    });

    // RAID SYNC LOGIC
    socket.on('raidAttack', (data) => { socket.to(data.roomCode).emit('raidAttackUpdate', { id: socket.id }); });
    socket.on('raidHazardHit', (data) => { socket.to(data.roomCode).emit('raidHazardUpdate', { id: socket.id }); });

    socket.on('dealDamage', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.boss && room.boss.hp > 0) {
            // Apply damage (or heal if damage is negative), cap at MAX_HP
            room.boss.hp = Math.min(room.boss.maxHp, Math.max(0, room.boss.hp - data.damage));
            io.to(data.roomCode).emit('bossHit', { newHp: room.boss.hp });
            if (room.boss.hp === 0) io.to(data.roomCode).emit('bossDefeated', { message: "The Boss has fallen!" });
        }
    });

    socket.on('requestRematch', async (data) => {
        const room = activeRooms[data.roomCode];
        if (room) {
            if (!room.rematchVoters) room.rematchVoters = new Set();
            if (room.rematchVoters.has(socket.id)) return;
            room.rematchVoters.add(socket.id);

            socket.to(data.roomCode).emit('rematchRequested');
            room.rematchVotes = room.rematchVoters.size;
            
            if (room.rematchVotes === 2) {
                io.to(data.roomCode).emit('rematchGenerating');
                room.rematchVotes = 0; 
                room.rematchVoters.clear();
                
                if (room.gameMode === 'syntaxArena') {
                    const snippet = await generateSyntaxSnippet(room.language);
                    room.corePosition = 0; room.status = 'playing';
                    io.to(data.roomCode).emit('rejoinSuccess', { players: room.players, snippet: snippet, selectedLanguage: room.language });
                } else if (room.gameMode === 'turboRacing') {
                    const text = await generateTypingText(2, 2);
                    room.status = 'playing';
                    io.to(data.roomCode).emit('rejoinSuccess', { players: room.players, text: text });
                }
            }
        }
    });

    socket.on('leaveRoom', (data) => {
        socket.to(data.roomCode).emit('opponentDisconnected', { id: socket.id, name: data.name || "OPPONENT" });
        const room = activeRooms[data.roomCode];
        if(room && room.players) delete room.players[socket.id];
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) waitingPlayer = null;
        for (const code in activeRooms) {
            const room = activeRooms[code];
            if (room.players && room.players[socket.id]) {
                 io.to(code).emit('opponentDisconnected', { id: socket.id, name: room.players[socket.id].name });
                 delete room.players[socket.id];
            }
        }
    });
});

setInterval(() => {
    for (const roomCode in activeRooms) {
        const room = activeRooms[roomCode];
        if (room.gameMode === 'syntaxArena' && room.status === 'playing') {
            io.to(roomCode).emit('syntaxCoreUpdate', { corePosition: room.corePosition });
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