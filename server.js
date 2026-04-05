require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('./models/User'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- AI INITIALIZATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" }); 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));


// --- EMAIL TRANSPORTER SETUP ---
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail', // Let Nodemailer handle the strict port/host routing automatically
        auth: { 
            user: process.env.EMAIL_USER, 
            pass: process.env.EMAIL_PASS.replace(/\s/g, '') 
        }
    });
    console.log("📧 Email Transporter Configured Successfully.");
} else {
    console.warn("\n⚠️ WARNING: No EMAIL_USER or EMAIL_PASS found in .env.");
    console.warn("📧 Email Simulation Mode Active: OTPs and Passwords will print here.\n");
}

const otpStore = {}; 

// --- AUTHENTICATION API ENDPOINTS ---
app.post('/api/send-otp', async (req, res) => {
    const { email, gamertag } = req.body;
    try {
        const existingUser = await User.findOne({ $or: [{ email }, { gamertag }] });
        if (existingUser) return res.status(400).json({ error: "Email or Gamertag already in use." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        otpStore[email] = { otp, expires: Date.now() + 10 * 60000 }; 

        const mailOptions = {
            from: process.env.EMAIL_USER || 'system@turbotype.com',
            to: email,
            subject: 'TurboType | Security Clearance OTP',
            text: `Welcome to TurboType.\n\nYour initialization security code is: ${otp}\n\nThis code expires in 10 minutes.`
        };

        if (transporter) {
            try {
                await transporter.sendMail(mailOptions);
            } catch (mailErr) {
                console.error("Nodemailer Auth Error:", mailErr);
                return res.status(500).json({ error: "Email configuration error. Check server logs." });
            }
        } else {
            console.log(`\n[EMAIL SIMULATION] Sent to: ${email} | OTP: ${otp}\n`);
        }

        res.json({ message: "OTP sent successfully." });
    } catch (error) {
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { email, gamertag, password, avatar, otp } = req.body;
        
        const storedData = otpStore[email];
        if (!storedData || storedData.otp !== otp) return res.status(400).json({ error: "Invalid or expired OTP." });
        if (Date.now() > storedData.expires) return res.status(400).json({ error: "OTP has expired." });

        delete otpStore[email];

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

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "Email not found in the mainframe." });

        const newPassword = Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        const mailOptions = {
            from: process.env.EMAIL_USER || 'system@turbotype.com',
            to: email,
            subject: 'TurboType | Password Reset Protocol',
            text: `Your security override was successful.\n\nYour new temporary password is: ${newPassword}\n\nPlease log in and update this from your Pilot Dossier immediately.`
        };

        if (transporter) {
            try {
                await transporter.sendMail(mailOptions);
            } catch (mailErr) {
                console.error("Nodemailer Auth Error:", mailErr);
                return res.status(500).json({ error: "Email configuration error. Check server logs." });
            }
        } else {
            console.log(`\n[EMAIL SIMULATION] Sent to: ${email} | NEW PASSWORD: ${newPassword}\n`);
        }

        res.json({ message: "New password dispatched to your email." });
    } catch (error) {
        res.status(500).json({ error: "Failed to process password reset." });
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

        const totalGames = user.games.turboRacing.played + user.games.samuraiTyping.played + user.games.syntaxArena.played + user.games.colosseumRaid.played + (user.games.neonRoyale ? user.games.neonRoyale.played : 0) + 1;
            
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
            if(!user.games.neonRoyale) user.games.neonRoyale = { played: 0, wins: 0 };
            user.games.neonRoyale.played += 1;
            if (score === 1) user.games.neonRoyale.wins += 1; 
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

async function generateSamuraiWords(waveLevel) {
    let count = Math.min(10 + (waveLevel * 2), 30); 
    let diff = waveLevel <= 2 ? "simple 4-letter" : (waveLevel <= 5 ? "medium 6-8 letter" : "complex 9+ letter");
    
    const prompt = `Task: Generate a comma-separated list of exactly ${count} ${diff} words related to combat, ninjas, or zombies. Output ONLY the words, separated by commas. No spaces or formatting.`;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/\n/g, '').toUpperCase();
        return text.split(',').map(w => w.trim()).filter(w => w.length > 0);
    } catch (error) {
        const fallbackWords = ["BITE", "SLASH", "DASH", "RUN", "ZOMBIE", "CLAW", "BLOOD", "BONE", "SWORD", "NINJA", "STRIKE", "INFECTED", "MUTANT", "HORDE", "SURVIVE", "SHURIKEN", "VENGEANCE", "ASSASSIN"];
        return fallbackWords.sort(() => 0.5 - Math.random()).slice(0, count);
    }
}

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
        const easyBackups = ["the cat ran fast and the dog sat down on the rug to nap in the sun", "you can win this race if you try hard and type fast with no bad keys", "red car blue car one two go run far out and get the top spot now"];
        const hardBackups = ["The ancient behemoth roared, sending shockwaves through the shattered colosseum! Knights raised their shields, bracing against the devastating hellfire.", "Navigating the corrupted mainframe, the rogue AI deployed a multi-threaded payload. 'Access Denied,' the terminal flashed, locking the encrypted data.", "Dark matter pulsed within the alien dreadnought. Antimatter cannons charged to maximum capacity, threatening to obliterate the fragile human resistance!"];
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
}`,
`const dataStream = [0x4A, 0x1F, 0x8C, 0x3B];
let decryptedPayload = dataStream.map(byte => {
  let shift = (byte << 2) & 0xFF;
  return shift ^ 0xAA;
});
console.log(decryptedPayload);`
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

// --- NEON ROYALE ENGINE ---
async function startNeonRound(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

    const diff = room.round < 4 ? 1 : (room.round < 7 ? 2 : 3);
    const text = await generateTypingText(diff, 2);
    
    room.roundTimer = 60 - (room.round * 4); 
    if(room.roundTimer < 20) room.roundTimer = 20;

    room.survivors.forEach(id => {
        if(room.players[id]) {
            room.players[id].progress = 0;
            room.players[id].wpm = 0;
        }
    });

    io.to(roomCode).emit('neonRoundStart', {
        round: room.round,
        timer: room.roundTimer,
        players: room.players,
        survivors: room.survivors,
        text: text
    });

    if(room.botInterval) clearInterval(room.botInterval);
    room.botInterval = setInterval(() => {
        let updated = false;
        room.survivors.forEach(id => {
            const p = room.players[id];
            if(p && p.isBot && p.progress < 1) {
                let speed = room.botDifficulty === 'Hard' ? 0.04 : (room.botDifficulty === 'Medium' ? 0.025 : 0.015);
                speed += (Math.random() * 0.015 - 0.005); 
                p.progress = Math.min(1, p.progress + speed);
                p.wpm = (p.progress * 100) + Math.random() * 20;
                updated = true;
            }
        });
        if(updated) io.to(roomCode).emit('neonBotUpdate', { players: room.players });
    }, 1000);

    if(room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
        room.roundTimer--;
        io.to(roomCode).emit('neonTimerTick', { timer: room.roundTimer });

        let allFinished = room.survivors.every(id => room.players[id].progress >= 1);

        if (room.roundTimer <= 0 || allFinished) {
            clearInterval(room.timerInterval);
            clearInterval(room.botInterval);
            handleNeonElimination(roomCode);
        }
    }, 1000);
}

function handleNeonElimination(roomCode) {
    const room = activeRooms[roomCode];
    if(!room) return;

    let lowestId = room.survivors[0];
    let lowestScore = 999999;
    room.survivors.forEach(id => {
        const p = room.players[id];
        let score = (p.progress * 1000) + p.wpm;
        if(score < lowestScore) { lowestScore = score; lowestId = id; }
    });

    const eliminatedPlayer = room.players[lowestId];
    eliminatedPlayer.rank = room.survivors.length;
    room.survivors = room.survivors.filter(id => id !== lowestId);

    io.to(roomCode).emit('neonElimination', {
        survivors: room.survivors,
        eliminated: eliminatedPlayer
    });

    if (room.survivors.length <= 1) {
        if(room.survivors.length === 1) {
            room.players[room.survivors[0]].rank = 1;
        }
        const leaderboard = Object.values(room.players).sort((a,b) => a.rank - b.rank);
        setTimeout(() => {
            io.to(roomCode).emit('neonGameOver', { leaderboard });
        }, 3000);
    } else {
        let intTimer = 5;
        room.round++;
        const intInterval = setInterval(() => {
            intTimer--;
            io.to(roomCode).emit('neonIntermissionTick', { timer: intTimer });
            if(intTimer <= 0) {
                clearInterval(intInterval);
                startNeonRound(roomCode);
            }
        }, 1000);
    }
}


// --- SOCKET.IO MULTIPLAYER ROUTING ---
io.on('connection', (socket) => {
    socket.on('requestSamuraiWave', async (data) => {
        const wave = data.wave || 1;
        const words = await generateSamuraiWords(wave);
        socket.emit('samuraiWaveData', { wave: wave, words: words });
    });

    socket.on('createRoom', async (data) => {
        const roomCode = generateRoomCode();
        const user = await User.findOne({ gamertag: data.name });
        const pScore = user ? user.skillScore : 0;

        activeRooms[roomCode] = {
            roomCode: roomCode,
            gameMode: data.gameMode || 'turboRacing',
            language: data.language || 'JavaScript', 
            raceLength: data.length || 2,
            status: 'waiting',
            players: { [socket.id]: { id: socket.id, name: data.name, progress: 0, wpm: 0, skillScore: pScore } },
            rematchVoters: new Set()
        };

        if (data.gameMode === 'colosseumRaid') {
            const loreText = await generateTypingText(3, 3);
            activeRooms[roomCode].boss = { maxHp: BOSS_MAX_HP, hp: BOSS_MAX_HP, activeLore: loreText };
        }

        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode: roomCode, boss: activeRooms[roomCode].boss });
        
        if (data.gameMode === 'neonRoyale') {
            io.to(roomCode).emit('playerJoinedLobby', { players: Object.values(activeRooms[roomCode].players) });
        }
    });

    socket.on('joinRoom', async (data) => {
        const room = activeRooms[data.roomCode];
        if (!room) return socket.emit('roomError', 'Room not found.');
        if (room.status !== 'waiting') return socket.emit('roomError', 'Match already in progress.');
        
        const user = await User.findOne({ gamertag: data.name });
        const pScore = user ? user.skillScore : 0;

        room.players[socket.id] = { id: socket.id, name: data.name, progress: 0, wpm: 0, skillScore: pScore };
        socket.join(data.roomCode);

        if (room.gameMode === 'turboRacing' && Object.keys(room.players).length === 2) {
            room.status = 'playing';
            const pIds = Object.keys(room.players);
            const minScore = Math.min(room.players[pIds[0]].skillScore, room.players[pIds[1]].skillScore);
            let diffLevel = minScore < 250 ? 1 : (minScore >= 700 ? 3 : 2);
            const text = await generateTypingText(diffLevel, room.raceLength);
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
            
        } else if (room.gameMode === 'neonRoyale') {
            io.to(data.roomCode).emit('playerJoinedLobby', { players: Object.values(room.players) });
        }
    });

    socket.on('startNeonRoyale', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.gameMode === 'neonRoyale') {
            room.status = 'playing';
            room.botDifficulty = data.botDifficulty || 'Medium';
            room.round = 1;
            room.survivors = Object.keys(room.players);

            const botNames = ['Zero', 'Alpha', 'Bravo', 'Nexus', 'Cypher', 'Glitch', 'Proxy', 'Vector', 'Ghost'];
            while (room.survivors.length < 10) {
                let botId = 'bot_' + Math.random().toString(36).substr(2, 5);
                let bName = botNames.pop() || 'BotX';
                room.players[botId] = { id: botId, name: bName, isBot: true, progress: 0, wpm: 0 };
                room.survivors.push(botId);
            }

            io.to(data.roomCode).emit('neonGameStarting');
            startNeonRound(data.roomCode);
        }
    });

    socket.on('updateProgress', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.players[socket.id]) {
            room.players[socket.id].progress = data.progress;
            room.players[socket.id].wpm = data.wpm;
        }
        socket.to(data.roomCode).emit('opponentProgress', data);
    });

    socket.on('syntaxKeystroke', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.status === 'playing' && room.players[socket.id]) {
            room.corePosition += (room.players[socket.id].tugDirection * 2.5); 
        }
    });

    socket.on('raidAttack', (data) => { socket.to(data.roomCode).emit('raidAttackUpdate', { id: socket.id }); });
    socket.on('raidHazardHit', (data) => { socket.to(data.roomCode).emit('raidHazardUpdate', { id: socket.id }); });

    socket.on('dealDamage', (data) => {
        const room = activeRooms[data.roomCode];
        if (room && room.boss && room.boss.hp > 0) {
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
            
            if (room.rematchVoters.size === 2) {
                io.to(data.roomCode).emit('rematchGenerating');
                room.rematchVoters.clear();
                
                if (room.gameMode === 'syntaxArena') {
                    const snippet = await generateSyntaxSnippet(room.language);
                    room.corePosition = 0; room.status = 'playing';
                    io.to(data.roomCode).emit('rejoinSuccess', { players: room.players, snippet: snippet, selectedLanguage: room.language });
                } else if (room.gameMode === 'turboRacing') {
                    const pIds = Object.keys(room.players);
                    const minScore = Math.min(room.players[pIds[0]].skillScore, room.players[pIds[1]].skillScore);
                    let diffLevel = minScore < 250 ? 1 : (minScore >= 700 ? 3 : 2);

                    const text = await generateTypingText(diffLevel, room.raceLength || 2);
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