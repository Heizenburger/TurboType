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
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

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

        const totalGames = user.games.turboRacing.played + user.games.samuraiTyping.played + 1;
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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Create a Unified Room
    socket.on('createRoom', async (data) => {
        const roomCode = generateRoomCode();
        socket.join(roomCode);
        
        let userSkillScore = 0;
        try {
            const user = await User.findOne({ gamertag: data.name });
            if (user) userSkillScore = user.skillScore;
        } catch (e) {}
        
        activeRooms[roomCode] = {
            id: roomCode,
            gameMode: data.gameMode,
            players: { [data.name]: { 
                id: socket.id, 
                name: data.name, 
                progress: 0, 
                wpm: 0, 
                connected: true, 
                skillScore: userSkillScore, 
                wantsRematch: false,
                language: data.language || 'JavaScript' // Store Player's Chosen Language
            } },
            status: data.gameMode === 'colosseumRaid' ? 'playing' : 'waiting',
            text: null, snippet: null, boss: null, disconnectTimer: null,
            corePosition: 0 // TUG-OF-WAR ENGINE TRACKER
        };
        
        if (data.gameMode === 'turboRacing') {
            activeRooms[roomCode].length = data.length;
        } else if (data.gameMode === 'colosseumRaid') {
            activeRooms[roomCode].boss = { hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, activeLore: "The massive obsidian behemoth rises from the ashes of the ruined arena. Its eyes burn with the fury of a thousand crashed servers. You must band together, synchronize your keystrokes, and strike with absolute precision to shatter its impenetrable armor." };
        }
        
        socket.emit('roomCreated', { roomCode, boss: activeRooms[roomCode].boss });
    });

    // 2. Join a Unified Room
    socket.on('joinRoom', async (data) => {
        const room = activeRooms[data.roomCode];
        if (!room) return socket.emit('roomError', "Room not found or expired.");

        // Crash Recovery Rejoin Logic
        if (room.players[data.name]) {
            if (room.status === 'waiting' && room.gameMode !== 'colosseumRaid') {
                socket.join(data.roomCode);
                room.players[data.name].id = socket.id;
                room.players[data.name].connected = true;
                return socket.emit('roomCreated', { roomCode: data.roomCode });
            }

            if (room.status === 'playing' && room.gameMode !== 'colosseumRaid' && !room.text && !room.snippet) {
                return socket.emit('roomError', "Match is starting, please wait...");
            }
            
            socket.join(data.roomCode);
            clearTimeout(room.disconnectTimer); 
            room.players[data.name].id = socket.id;
            room.players[data.name].connected = true;
            
            if (room.gameMode === 'colosseumRaid') {
                socket.emit('rejoinRaidSuccess', { boss: room.boss, players: Object.values(room.players) });
            } else if (room.gameMode === 'syntaxArena') {
                socket.emit('rejoinSuccess', { snippet: room.snippet, players: Object.values(room.players) });
            } else {
                socket.emit('rejoinSuccess', { text: room.text, players: Object.values(room.players) });
            }
            
            socket.to(data.roomCode).emit('opponentReconnected', { name: data.name });
            return;
        }

        // Normal Join Logic
        if (room.gameMode !== 'colosseumRaid') {
            if (room.status === 'playing') return socket.emit('roomError', "Match already in progress.");
            if (Object.keys(room.players).length >= 2) return socket.emit('roomError', "Room is full.");
        }

        let userSkillScore = 0;
        try {
            const user = await User.findOne({ gamertag: data.name });
            if (user) userSkillScore = user.skillScore;
        } catch (e) {}

        socket.join(data.roomCode);
        room.players[data.name] = { 
            id: socket.id, 
            name: data.name, 
            progress: 0, 
            wpm: 0, 
            connected: true, 
            skillScore: userSkillScore, 
            wantsRematch: false,
            language: data.language || 'JavaScript' // Store Challenger's Chosen Language
        };
        
        if (room.gameMode === 'colosseumRaid') {
            socket.emit('raidState', { boss: room.boss, players: Object.values(room.players) });
            socket.to(data.roomCode).emit('playerJoinedRaid', { name: data.name });
            return;
        }

        room.status = 'playing';
        socket.emit('roomError', "Generating AI Content...");

        if (room.gameMode === 'turboRacing') {
            const p1 = Object.values(room.players)[0];
            const p2 = Object.values(room.players)[1];
            const minSkill = Math.min(p1.skillScore || 0, p2.skillScore || 0);
            
            let difficulty = 2; // Default Medium
            if (minSkill < 250) difficulty = 1;
            else if (minSkill >= 250 && minSkill < 700) difficulty = 2;
            else difficulty = 3;

            room.text = await generateTypingText(difficulty, room.length);
            io.to(data.roomCode).emit('matchStart', { text: room.text, players: Object.values(room.players) });
            
        } else if (room.gameMode === 'syntaxArena') {
            const players = Object.values(room.players);
            const p1 = players[0];
            const p2 = players[1];
            
            // 1. LANGUAGE RESOLUTION
            let selectedLanguage = p1.language;
            if (p1.language !== p2.language) {
                selectedLanguage = Math.random() > 0.5 ? p1.language : p2.language;
            }
            room.selectedLanguage = selectedLanguage;

            // 2. SKILL CEILING & UNDERDOG MULTIPLIERS
            const ceiling = Math.max(p1.skillScore || 0, p2.skillScore || 0);
            
            // Calculate pull weight multiplier for each player (min 1x, bounded to 10 minimum score safety)
            p1.pullMultiplier = Math.max(1, ceiling / Math.max(10, p1.skillScore || 10));
            p2.pullMultiplier = Math.max(1, ceiling / Math.max(10, p2.skillScore || 10));
            
            // Setup Tug-of-War directional limits (-1 pulls left, 1 pulls right)
            p1.tugDirection = -1;
            p2.tugDirection = 1;
            
            // Generate Code via Gemini!
            room.snippet = await generateSyntaxSnippet(ceiling, selectedLanguage);
            io.to(data.roomCode).emit('syntaxMatchFound', { 
                snippet: room.snippet, 
                selectedLanguage: selectedLanguage,
                players: players 
            });
        }
    });

    // 3. Multi-Game Progress Synchronization
    socket.on('updateProgress', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.players[data.name]) {
            room.players[data.name].progress = data.progress;
            room.players[data.name].wpm = data.wpm;
            socket.to(data.roomCode).emit('opponentProgress', data);
        }
    });

    // REPLACED OLD 'syntaxProgress' WITH NEW TUG-OF-WAR ENGINE
    socket.on('syntaxKeystroke', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.gameMode === 'syntaxArena' && room.status === 'playing') {
            const player = room.players[data.name];
            if (player) {
                // Calculate physical pull force based on snippet length and player's handicap
                const baseForce = 100 / Math.max(10, room.snippet.length / 2);
                const pullForce = baseForce * player.pullMultiplier;
                
                room.corePosition += player.tugDirection * pullForce;
                
                // Clamp position to exact limits
                if (room.corePosition < -100) room.corePosition = -100;
                if (room.corePosition > 100) room.corePosition = 100;
            }
        }
    });

    socket.on('syntaxSabotage', (data) => {
        socket.to(data.roomCode).emit('receiveSabotage');
    });

    socket.on('dealDamage', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.gameMode === 'colosseumRaid' && room.boss.hp > 0) {
            room.boss.hp -= data.damage;
            if (room.boss.hp < 0) room.boss.hp = 0;

            io.to(data.roomCode).emit('bossHit', { attacker: data.name, damage: data.damage, newHp: room.boss.hp });

            if (room.boss.hp <= 0) {
                io.to(data.roomCode).emit('bossDefeated', { message: "THE BEHEMOTH HAS FALLEN!" });
                setTimeout(() => {
                    if (activeRooms[data.roomCode]) {
                        activeRooms[data.roomCode].boss.hp = BOSS_MAX_HP;
                        io.to(data.roomCode).emit('bossRespawned', activeRooms[data.roomCode].boss);
                    }
                }, 10000);
            }
        }
    });

    // 4. Handle Disconnections
    socket.on('disconnect', () => {
        for (const roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            const playerEntry = Object.values(room.players).find(p => p.id === socket.id);
            
            if (playerEntry) {
                playerEntry.connected = false;
                
                if (room.gameMode === 'colosseumRaid') {
                    socket.to(roomCode).emit('playerLeftRaid', { name: playerEntry.name });
                    const anyConnected = Object.values(room.players).some(p => p.connected);
                    if (!anyConnected) {
                        room.disconnectTimer = setTimeout(() => { delete activeRooms[roomCode]; }, 60000);
                    }
                    break;
                }

                if (room.status === 'waiting') {
                    delete activeRooms[roomCode];
                    return;
                }

                socket.to(roomCode).emit('opponentDisconnected', { name: playerEntry.name });
                
                room.disconnectTimer = setTimeout(() => {
                    io.to(roomCode).emit('forfeitWin', { message: `${playerEntry.name} abandoned the match.` });
                    delete activeRooms[roomCode];
                }, 60000); 
                break;
            }
        }
    });

    // 5. Handle Voluntary Exits
    socket.on('leaveRoom', (data) => {
        const room = activeRooms[data.roomCode];
        if (room) {
            if (room.gameMode === 'colosseumRaid') {
                delete room.players[data.name];
                socket.to(data.roomCode).emit('playerLeftRaid', { name: data.name });
            } else {
                socket.to(data.roomCode).emit('forfeitWin', { message: "Opponent surrendered." });
                delete activeRooms[data.roomCode];
            }
        }
    });

    // 6. Handle Seamless Rematch Requests
    socket.on('requestRematch', async (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.players[data.name]) {
            room.players[data.name].wantsRematch = true;
            const players = Object.values(room.players);
            
            // Check if both players clicked Rematch
            if (players.length === 2 && players.every(p => p.wantsRematch)) {
                io.to(data.roomCode).emit('rematchGenerating');

                // Reset player stats for the new match
                players.forEach(p => { 
                    p.progress = 0; 
                    p.wpm = 0; 
                    p.wantsRematch = false; 
                });
                
                if (room.gameMode === 'syntaxArena') {
                    room.corePosition = 0;
                    room.status = 'playing';
                    const ceiling = Math.max(players[0].skillScore || 0, players[1].skillScore || 0);
                    room.snippet = await generateSyntaxSnippet(ceiling, room.selectedLanguage);
                    io.to(data.roomCode).emit('syntaxMatchFound', { 
                        snippet: room.snippet, 
                        selectedLanguage: room.selectedLanguage,
                        players: players 
                    });
                } else if (room.gameMode === 'turboRacing') {
                    // Recalculate adaptive difficulty
                    const minSkill = Math.min(players[0].skillScore || 0, players[1].skillScore || 0);
                    let difficulty = 2; 
                    if (minSkill < 250) difficulty = 1;
                    else if (minSkill >= 250 && minSkill < 700) difficulty = 2;
                    else difficulty = 3;

                    room.text = await generateTypingText(difficulty, room.length);
                    io.to(data.roomCode).emit('matchStart', { text: room.text, players: players });
                }
            } else {
                // Let the other player know we are waiting for them
                socket.to(data.roomCode).emit('rematchRequested');
            }
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