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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

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

        const neonPlayed = user.games.neonRoyale ? user.games.neonRoyale.played : 0;
        const totalGames = user.games.turboRacing.played + user.games.samuraiTyping.played + user.games.syntaxArena.played + user.games.colosseumRaid.played + neonPlayed + 1;
            
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
        } else if (gameMode === 'neonRoyale') {
            // Guarantee object initialization inside the schema
            if (!user.games.neonRoyale) user.games.neonRoyale = { played: 0, wins: 0 };
            user.games.neonRoyale.played += 1;
            // The Client will pass 'score = 1' only if their rank was #1
            if (score === 1) user.games.neonRoyale.wins += 1;
            user.markModified('games');
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

// BOT CONFIGURATION (Neon Royale)
const BOT_NAMES = ['Neon_Ghost', 'Cyber_Racer', 'Byte_Runner', 'Glitch_King', 'Pixel_Punk', 'Zero_Cool', 'Data_Wraith', 'Synth_Wave', 'Circuit_Breaker', 'Code_Samurai'];
const BOT_SPEEDS = {
    'Easy': { min: 10, max: 25 },
    'Medium': { min: 26, max: 40 },
    'Hard': { min: 41, max: 70 }
};

function generateRoomCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

// --- AI GENERATORS ---
async function generateTypingText(difficultyLevel, lengthLevel = 2) {
    let wordCount = 50; 
    if (lengthLevel === 1) wordCount = 20;       
    else if (lengthLevel === 2) wordCount = 50;  
    else if (lengthLevel === 3) wordCount = 120; 

    const seed = Math.floor(Math.random() * 100000);
    let prompt = "";
    
    if (difficultyLevel === 1) prompt = `Task [${seed}]: Generate a text containing exactly ${wordCount} words. USE ONLY extremely simple, 3-to-4 letter words. DO NOT use any punctuation marks whatsoever. The output MUST be 100% lowercase plain text consisting only of easy words.`;
    else if (difficultyLevel === 2) prompt = `Task [${seed}]: Write a standard ${wordCount}-word paragraph about technology or racing. Use normal sentence structure, basic punctuation (commas, periods), and standard capitalization.`;
    else prompt = `Task [${seed}]: Write a highly complex ${wordCount}-word paragraph for an advanced typing test. Include difficult vocabulary, frequent numbers, and special characters like parentheses (), quotes, semicolons, and hyphens.`;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/\n/g, ' ').trim();
        if (difficultyLevel === 1) text = text.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
        return text;
    } catch (error) {
        console.error("Typing AI Rate Limit Hit - Using Fallback.");
        const easyBackups = [
            "the cat ran fast and the dog sat down on the rug to nap in the sun",
            "you can win this race if you try hard and type fast with no bad keys"
        ];
        const hardBackups = [
            "The turbocharged engine roared to life, accelerating past 200 MPH! Drivers navigated tight apexes, drifting seamlessly through the neon-lit cyberpunk metropolis.",
            "Navigating through the intricate circuits of the mainframe, the hacker deployed a multi-threaded payload. 'Access Granted,' the terminal flashed, securing the encrypted data."
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
        const fallbacks = [
`function calculateTrajectory(velocity, angle) {
  const gravity = 9.81;
  const rad = angle * (Math.PI / 180);
  let distance = (Math.pow(velocity, 2) * Math.sin(2 * rad)) / gravity;
  return parseFloat(distance.toFixed(2));
}`
        ];
        return fallbacks[0];
    }
}

async function generateNeonText(roundNumber) {
    let wordCount = 50;
    let prompt = "";
    const seed = Math.floor(Math.random() * 100000);
    
    if (roundNumber <= 5) {
        wordCount = 50;
        prompt = `Task [${seed}]: Write an easy ${wordCount}-word paragraph. Use simple sentence structure and basic punctuation. Ensure exactly ${wordCount} words.`;
    } else if (roundNumber <= 8) {
        wordCount = 70;
        prompt = `Task [${seed}]: Write a complex ${wordCount}-word paragraph. Include difficult vocabulary, numbers, and special characters like quotes and semicolons. Ensure exactly ${wordCount} words.`;
    } else {
        wordCount = 120;
        prompt = `Task [${seed}]: Write an extremely complex ${wordCount}-word paragraph for a final typing duel. Use dense cyberpunk terminology, symbols, and varied punctuation. Ensure exactly ${wordCount} words.`;
    }

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().replace(/\n/g, ' ').trim();
    } catch (error) {
        console.error("Neon AI Rate Limit - Using Fallback.");
        const fb = "The neon city glowing brightly under the digital rain matrix protocol override systems engaging. ";
        let res = fb;
        while(res.split(' ').length < wordCount) res += fb;
        return res.split(' ').slice(0, wordCount).join(' ');
    }
}


// --- SOCKET.IO MULTIPLAYER LOGIC ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', async (data) => {
        const roomCode = generateRoomCode();
        
        let userSkillScore = 0;
        try {
            const user = await User.findOne({ gamertag: data.name });
            if (user) userSkillScore = user.skillScore;
        } catch (e) {}

        activeRooms[roomCode] = {
            roomCode: roomCode,
            gameMode: data.gameMode || 'turboRacing',
            language: data.language || 'JavaScript', 
            botDifficulty: data.botDifficulty || 'Medium',
            hostId: socket.id,
            status: 'waiting',
            players: { [socket.id]: { 
                id: socket.id, name: data.name, progress: 0, wpm: 0, 
                connected: true, skillScore: userSkillScore 
            }},
            rematchVoters: new Set()
        };

        if (data.gameMode === 'colosseumRaid') {
            const loreText = await generateTypingText(3, 3);
            activeRooms[roomCode].boss = { maxHp: BOSS_MAX_HP, hp: BOSS_MAX_HP, activeLore: loreText };
        } else if (data.gameMode === 'neonRoyale') {
            activeRooms[roomCode].round = 0;
            activeRooms[roomCode].survivors = [];
            activeRooms[roomCode].eliminated = [];
            activeRooms[roomCode].timer = 0;
        }

        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode: roomCode, boss: activeRooms[roomCode].boss });
    });

    socket.on('joinRoom', async (data) => {
        const room = activeRooms[data.roomCode];
        if (!room) return socket.emit('roomError', 'Room not found.');
        if (room.status !== 'waiting' && room.gameMode !== 'colosseumRaid') return socket.emit('roomError', 'Match already in progress.');
        
        let userSkillScore = 0;
        try {
            const user = await User.findOne({ gamertag: data.name });
            if (user) userSkillScore = user.skillScore;
        } catch (e) {}

        room.players[socket.id] = { id: socket.id, name: data.name, progress: 0, wpm: 0, connected: true, skillScore: userSkillScore };
        socket.join(data.roomCode);

        io.to(data.roomCode).emit('playerJoinedLobby', { players: Object.values(room.players) });

        if (room.gameMode === 'turboRacing' && Object.keys(room.players).length === 2) {
            room.status = 'playing';
            const text = await generateTypingText(2, 2);
            io.to(data.roomCode).emit('matchStart', { players: room.players, text: text });
            
        } else if (room.gameMode === 'colosseumRaid') {
            socket.emit('raidState', { roomCode: data.roomCode, boss: room.boss });
            socket.to(data.roomCode).emit('playerJoinedRaid', { name: data.name });
            
        } else if (room.gameMode === 'syntaxArena' && Object.keys(room.players).length === 2) {
            room.status = 'playing';
            room.corePosition = 0;
            
            const pIds = Object.keys(room.players);
            room.players[pIds[0]].tugDirection = -1; // P1 pulls left
            room.players[pIds[1]].tugDirection = 1;  // P2 pulls right

            const snippet = await generateSyntaxSnippet(room.language);
            io.to(data.roomCode).emit('syntaxMatchFound', { 
                players: room.players, 
                snippet: snippet,
                selectedLanguage: room.language
            });
        }
    });

    socket.on('startNeonRoyale', async (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.hostId === socket.id && room.status === 'waiting') {
            room.status = 'starting';
            io.to(data.roomCode).emit('neonGameStarting'); 
            
            let currentPlayers = Object.keys(room.players).length;
            let botsNeeded = 10 - currentPlayers;
            let usedNames = Object.values(room.players).map(p => p.name);
            
            for(let i = 0; i < botsNeeded; i++) {
                let botName = BOT_NAMES.find(n => !usedNames.includes(n)) || `Bot_${Math.floor(Math.random()*1000)}`;
                usedNames.push(botName);
                let botId = 'bot_' + Math.random().toString(36).substr(2, 9);
                
                let speeds = BOT_SPEEDS[room.botDifficulty];
                let botWpm = Math.floor(Math.random() * (speeds.max - speeds.min + 1)) + speeds.min;
                
                room.players[botId] = {
                    id: botId, name: botName, progress: 0, wpm: botWpm, 
                    connected: true, isBot: true, skillScore: Math.floor(Math.random() * 500) + 100
                };
            }
            
            room.survivors = Object.keys(room.players);
            await startNeonRound(room);
        }
    });

    socket.on('updateProgress', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progress = data.progress;
            room.players[socket.id].wpm = data.wpm;
            socket.to(data.roomCode).emit('opponentProgress', data);
        }
    });

    socket.on('syntaxKeystroke', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.status === 'playing') {
            const player = room.players[socket.id]; 
            if (player) room.corePosition += (player.tugDirection * 2.5); 
        }
    });

    socket.on('dealDamage', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.boss && room.boss.hp > 0) {
            room.boss.hp = Math.max(0, room.boss.hp - data.damage);
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
                room.rematchVotes = 0; room.rematchVoters.clear();
                
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
        const room = activeRooms[data.roomCode];
        if(room) {
            if (room.players[socket.id]) {
                room.players[socket.id].connected = false;
                room.players[socket.id].disconnectTime = Date.now();
            }
            if (room.gameMode !== 'neonRoyale') {
                socket.to(data.roomCode).emit('opponentDisconnected', { name: "OPPONENT" });
                delete activeRooms[data.roomCode];
            } else {
                const anyHumanConnected = Object.values(room.players).some(p => !p.isBot && p.connected);
                if (!anyHumanConnected) {
                    delete activeRooms[data.roomCode];
                }
            }
        }
    });

    socket.on('disconnect', () => {
        for (let code in activeRooms) {
            const room = activeRooms[code];
            if (room.players[socket.id]) {
                room.players[socket.id].connected = false;
                room.players[socket.id].disconnectTime = Date.now();
                if(room.gameMode !== 'neonRoyale') {
                    io.to(code).emit('opponentDisconnected', { name: room.players[socket.id].name });
                }
                
                const anyHumanConnected = Object.values(room.players).some(p => !p.isBot && p.connected);
                if (!anyHumanConnected) {
                    delete activeRooms[code];
                }
            }
        }
        if (typeof waitingPlayer !== 'undefined' && waitingPlayer && waitingPlayer.id === socket.id) waitingPlayer = null;
    });
});

// --- NEON ROYALE ROUND LOGIC ENGINE ---
async function startNeonRound(room) {
    room.round++;
    room.status = 'playing';
    
    // Increased timers to be much more forgiving!
    room.timer = room.round <= 5 ? 90 : (room.round <= 8 ? 120 : 180);
    
    if (!room.nextText) room.text = await generateNeonText(room.round);
    else room.text = room.nextText;
    
    room.wordCount = room.text.split(' ').length;
    
    for(let id of room.survivors) {
        room.players[id].progress = 0;
        room.players[id].wpm = room.players[id].isBot ? room.players[id].wpm : 0; 
    }
    
    io.to(room.roomCode).emit('neonRoundStart', {
        round: room.round,
        timer: room.timer,
        text: room.text,
        survivors: room.survivors,
        players: room.players
    });

    if (room.round < 9) {
        generateNeonText(room.round + 1).then(t => room.nextText = t);
    }
}

function executeNeonElimination(room) {
    room.status = 'intermission';
    let candidates = room.survivors.map(id => room.players[id]);
    let unfinished = candidates.filter(p => p.progress < 1);
    let eliminatedPlayer;
    
    if (unfinished.length === 1) {
        eliminatedPlayer = unfinished[0];
    } else if (unfinished.length > 1) {
        unfinished.sort((a,b) => {
            let wordsA = Math.floor(a.progress * room.wordCount);
            let wordsB = Math.floor(b.progress * room.wordCount);
            if (wordsA !== wordsB) return wordsA - wordsB; 
            if (a.wpm !== b.wpm) return a.wpm - b.wpm;     
            return (b.skillScore || 0) - (a.skillScore || 0); 
        });
        eliminatedPlayer = unfinished[0];
    } else {
        candidates.sort((a,b) => {
            if (a.wpm !== b.wpm) return a.wpm - b.wpm; 
            return (b.skillScore || 0) - (a.skillScore || 0); 
        });
        eliminatedPlayer = candidates[0];
    }
    
    room.survivors = room.survivors.filter(id => id !== eliminatedPlayer.id);
    eliminatedPlayer.rank = room.survivors.length + 1; 
    room.eliminated.unshift(eliminatedPlayer); 
    
    io.to(room.roomCode).emit('neonElimination', { eliminated: eliminatedPlayer, survivors: room.survivors });
    
    if (room.round >= 9 || room.survivors.length <= 1) {
        room.status = 'finished';
        if(room.survivors.length === 1) {
            let winner = room.players[room.survivors[0]];
            winner.rank = 1;
            room.eliminated.unshift(winner);
        }
        io.to(room.roomCode).emit('neonGameOver', { leaderboard: room.eliminated });
    } else {
        room.intermissionTimer = 5;
        let intInterval = setInterval(() => {
            room.intermissionTimer--;
            io.to(room.roomCode).emit('neonIntermissionTick', { timer: room.intermissionTimer });
            if (room.intermissionTimer <= 0) {
                clearInterval(intInterval);
                if (room.status === 'intermission') startNeonRound(room);
            }
        }, 1000);
    }
}

setInterval(() => {
    for (const roomCode in activeRooms) {
        const room = activeRooms[roomCode];
        
        if (room.status === 'playing') {
            if (room.gameMode === 'syntaxArena') {
                io.to(roomCode).emit('syntaxCoreUpdate', { corePosition: room.corePosition });
                if (room.corePosition <= -100 || room.corePosition >= 100) {
                    room.status = 'finished';
                    const winnerDirection = room.corePosition <= -100 ? -1 : 1;
                    const winner = Object.values(room.players).find(p => p.tugDirection === winnerDirection);
                    io.to(roomCode).emit('syntaxMatchEnded', { winner: winner ? winner.name : 'Unknown' });
                }
            } 
            else if (room.gameMode === 'neonRoyale') {
                let allFinished = true;
                for(let id of room.survivors) {
                    let p = room.players[id];
                    if (p.isBot && p.progress < 1) {
                        let progressPerSec = (p.wpm / 60) / room.wordCount;
                        p.progress += progressPerSec / 30; 
                        if (p.progress >= 1) p.progress = 1;
                    }
                    if (p.progress < 1) allFinished = false;
                }
                
                io.to(roomCode).emit('neonBotUpdate', { players: room.players });
                if (allFinished) executeNeonElimination(room);
            }
        }
    }
}, 1000 / 30);

setInterval(() => {
    for(const code in activeRooms) {
        const room = activeRooms[code];
        
        if (room.gameMode === 'neonRoyale') {
            if (room.status === 'playing') {
                room.timer--;
                io.to(code).emit('neonTimerTick', { timer: room.timer });
                if (room.timer <= 0) executeNeonElimination(room);
            }
            
            for(let id in room.players) {
                let p = room.players[id];
                if (!p.connected && !p.isBot && p.disconnectTime) {
                    if (Date.now() - p.disconnectTime > 60000) { 
                        p.isBot = true;
                        p.connected = true; 
                        let speeds = BOT_SPEEDS[room.botDifficulty];
                        p.wpm = Math.floor(Math.random() * (speeds.max - speeds.min + 1)) + speeds.min;
                    }
                }
            }
        }
    }
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});