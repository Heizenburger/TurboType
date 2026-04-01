const socket = io();
let playerName = localStorage.getItem('gamertag') || "PILOT";
let currentRoomCode = null;
let isHost = false;

// --- GAME STATE ---
let isPlaying = false;
let hasFinishedMatch = false;
let playersState = {};
let activeSurvivors = [];
let eliminatedPlayers = [];

// --- TYPING METRICS ---
let targetWords = [];
let currentWordIndex = 0;
let startTime = 0;
let lastWordCompleteTime = 0;
let totalTyped = 0;
let errors = 0;
let totalKeystrokes = 0;
let peakBurstWPM = 0;
let sessionTotalWpmSum = 0;
let roundCountLogged = 0;

// --- 1. LOBBY & INITIALIZATION ---
function hostRoom() {
    isHost = true;
    socket.emit('createRoom', { name: playerName, gameMode: 'neonRoyale' });
}

function joinExistingRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length < 5) return;
    currentRoomCode = code;
    socket.emit('joinRoom', { name: playerName, roomCode: code });
}

function surrenderMatch() {
    socket.emit('leaveRoom', { roomCode: currentRoomCode });
    localStorage.removeItem('activeRoomUrl');
    window.location.href = 'hub.html';
}

socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'block';
    
    document.getElementById('display-room-code').value = currentRoomCode;
    const shareableLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
    document.getElementById('display-room-link').value = shareableLink;
    
    window.history.pushState({ room: currentRoomCode }, '', `?room=${currentRoomCode}`);
    localStorage.setItem('activeRoomUrl', window.location.href);
});

socket.on('roomError', (msg) => {
    const errObj = document.getElementById('room-error');
    errObj.innerText = msg; errObj.style.display = 'block';
    if (msg.includes('not found') || msg.includes('expired') || msg.includes('progress')) {
        localStorage.removeItem('activeRoomUrl');
    }
});

// Update the 10-player waiting list
socket.on('playerJoinedLobby', (data) => {
    const list = document.getElementById('lobby-player-list');
    document.getElementById('player-count').innerText = data.players.length;
    list.innerHTML = data.players.map(p => `<li class="lobby-player-item">${p.name}</li>`).join('');
    
    if (isHost && data.players.length >= 1) {
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('waiting-msg').style.display = 'none';
    }
});

// Host initiates the Bot Backfill & starts the game
function startNeonMatch() {
    const diff = document.getElementById('bot-difficulty').value;
    socket.emit('startNeonRoyale', { roomCode: currentRoomCode, botDifficulty: diff });
}

// --- 2. MATCH & ROUND LOOP ---
socket.on('neonGameStarting', () => {
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex';
    document.getElementById('room-code-display').innerText = 'ROOM: ' + currentRoomCode;
});

socket.on('neonRoundStart', (data) => {
    document.getElementById('intermission-overlay').style.display = 'none';
    document.getElementById('round-display').innerText = `ROUND ${data.round} / 9`;
    document.getElementById('timer-display').innerText = data.timer;
    
    playersState = data.players;
    activeSurvivors = data.survivors;
    
    targetWords = data.text.split(' ');
    currentWordIndex = 0;
    totalTyped = 0;
    
    if (activeSurvivors.includes(socket.id)) {
        isPlaying = true;
        startTime = Date.now();
        lastWordCompleteTime = Date.now();
        document.getElementById('live-typing-display').innerText = "";
        enableKeyboard();
    } else {
        isPlaying = false; // Spectator mode for eliminated players
        document.getElementById('hidden-type-input').disabled = true;
    }
    
    document.getElementById('words-left-count').innerText = targetWords.length;
    renderText();
    updateGrid();
});

// --- 3. DYNAMIC 10-PLAYER GRID ENGINE ---
function getAvatar(player) {
    // If bot, seed is their name. If human, check DB or fallback to name seed.
    let seed = player.isBot ? player.name : `Bot${player.name}`;
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
}

function updateGrid() {
    const grid = document.getElementById('player-grid');
    let html = '';
    
    let survivorList = activeSurvivors.map(id => playersState[id]);
    let eliminatedList = Object.values(playersState).filter(p => !activeSurvivors.includes(p.id));
    
    // Sort survivors by progress, then WPM
    survivorList.sort((a,b) => {
        if (a.progress !== b.progress) return b.progress - a.progress;
        return b.wpm - a.wpm;
    });
    
    // Sort eliminated players by rank (10th at the bottom)
    eliminatedList.sort((a,b) => (b.rank || 10) - (a.rank || 10));
    
    // Render Survivors (Live Danger Zone Calc)
    survivorList.forEach((p, index) => {
        const rank = index + 1;
        const isMe = p.id === socket.id ? 'is-me' : '';
        const isDanger = (rank === survivorList.length && survivorList.length > 1) ? 'danger-zone' : '';
        
        html += `
            <div class="status-capsule ${isMe} ${isDanger}" id="capsule-${p.id}">
                <div class="rank-badge">${rank}</div>
                <div class="player-info">
                    <img src="${getAvatar(p)}">
                    <span class="player-name">${p.name}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${p.progress * 100}%"></div>
                </div>
                <div class="wpm-badge">${Math.round(p.wpm)} WPM</div>
            </div>
        `;
    });
    
    // Render Eliminated Players
    eliminatedList.forEach(p => {
        const isMe = p.id === socket.id ? 'is-me' : '';
        html += `
            <div class="status-capsule eliminated ${isMe}" id="capsule-${p.id}">
                <div class="eliminated-stamp">ELIMINATED</div>
                <div class="rank-badge">${p.rank || '-'}</div>
                <div class="player-info">
                    <img src="${getAvatar(p)}">
                    <span class="player-name">${p.name}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${p.progress * 100}%"></div>
                </div>
                <div class="wpm-badge">${Math.round(p.wpm)} WPM</div>
            </div>
        `;
    });
    
    grid.innerHTML = html;
}

// Live Updates from Server
socket.on('neonTimerTick', (data) => {
    document.getElementById('timer-display').innerText = data.timer;
});

socket.on('neonBotUpdate', (data) => {
    playersState = data.players;
    updateGrid();
});

socket.on('opponentProgress', (data) => {
    if (playersState[data.id]) {
        playersState[data.id].progress = data.progress;
        playersState[data.id].wpm = data.wpm;
    }
    updateGrid();
});

// --- 4. THE EXECUTIONER (Round End) ---
socket.on('neonElimination', (data) => {
    activeSurvivors = data.survivors;
    playersState[data.eliminated.id] = data.eliminated;
    
    // Log stats for final math
    if (playersState[socket.id]) {
        sessionTotalWpmSum += playersState[socket.id].wpm;
        roundCountLogged++;
    }

    if (data.eliminated.id === socket.id) {
        isPlaying = false;
        document.getElementById('hidden-type-input').disabled = true;
    }
    
    // Intermission Transition
    const overlay = document.getElementById('intermission-overlay');
    document.getElementById('intermission-subtitle').innerText = `${data.eliminated.name} ELIMINATED`;
    document.getElementById('intermission-timer').innerText = "5";
    overlay.style.display = 'flex';
    
    updateGrid();
});

socket.on('neonIntermissionTick', (data) => {
    document.getElementById('intermission-timer').innerText = data.timer;
});

// --- 5. TYPING ENGINE ---
function enableKeyboard() {
    const input = document.getElementById('hidden-type-input');
    input.value = ""; input.disabled = false; input.focus();
    
    document.removeEventListener('click', forceFocus); document.addEventListener('click', forceFocus);
    input.removeEventListener('input', handleTyping); input.addEventListener('input', handleTyping);
}

function forceFocus() { document.getElementById('hidden-type-input').focus(); }

function handleTyping(e) {
    if (!isPlaying) return;
    totalKeystrokes++; 
    
    const val = e.target.value; 
    const currentWord = targetWords[currentWordIndex];
    const currentWordEl = document.getElementById(`word-${currentWordIndex}`);
    const liveBox = document.getElementById('live-typing-display');

    liveBox.innerText = val;

    // Typo Detected
    if (!currentWord.startsWith(val.trim())) {
        currentWordEl.classList.add('error'); 
        liveBox.style.borderColor = '#ef4444'; liveBox.style.color = '#ef4444';
        errors++;
    } else {
        currentWordEl.classList.remove('error');
        liveBox.style.borderColor = '#06b6d4'; liveBox.style.color = 'white';
    }

    // Word Completed
    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            let now = Date.now(); 
            let wordTimeMins = Math.max(0.001, (now - lastWordCompleteTime) / 60000);
            let wordBurstWPM = Math.round((currentWord.length / 5) / wordTimeMins);
            if (wordBurstWPM > peakBurstWPM && wordBurstWPM < 300) peakBurstWPM = wordBurstWPM;
            lastWordCompleteTime = now; 
            
            totalTyped += currentWord.length + 1; 
            
            const timeElapsed = Math.max(0.1, (now - startTime) / 60000); 
            let currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;
            
            currentWordEl.classList.remove('current', 'error'); currentWordEl.classList.add('correct');
            currentWordIndex++; e.target.value = ""; liveBox.innerText = "";
            document.getElementById('words-left-count').innerText = targetWords.length - currentWordIndex;
            
            const nextWordEl = document.getElementById(`word-${currentWordIndex}`);
            if (nextWordEl) nextWordEl.classList.add('current');
            
            let myProgress = currentWordIndex / targetWords.length;
            
            // Sync to server
            playersState[socket.id].progress = myProgress;
            playersState[socket.id].wpm = currentWPM;
            socket.emit('updateProgress', { roomCode: currentRoomCode, progress: myProgress, wpm: currentWPM, id: socket.id });
            
            updateScroll(); 
            updateGrid();
        } else { errors++; }
    }
}

function updateScroll() {
    const currentWordEl = document.getElementById(`word-${currentWordIndex}`);
    if (currentWordEl) {
        const content = document.getElementById('text-content');
        content.style.transform = `translateY(-${currentWordEl.offsetTop}px)`;
    }
}

function renderText() {
    const html = targetWords.map((w, i) => {
        let classes = ['word'];
        if (i < currentWordIndex) classes.push('correct');
        else if (i === currentWordIndex) classes.push('current');
        return `<span class="${classes.join(' ')}" id="word-${i}">${w}</span>`; 
    }).join("");
    document.getElementById('text-content').innerHTML = html;
    updateScroll(); 
}

// --- 6. END GAME & LEADERBOARD ---
socket.on('neonGameOver', async (data) => {
    if (hasFinishedMatch) return;
    hasFinishedMatch = true;
    isPlaying = false;
    document.getElementById('hidden-type-input').disabled = true;
    localStorage.removeItem('activeRoomUrl');

    document.getElementById('intermission-overlay').style.display = 'none';
    document.getElementById('end-screen').style.display = 'flex';
    
    // Build Leaderboard HTML
    const lbBody = document.getElementById('final-leaderboard-body');
    let lbHtml = '';
    data.leaderboard.forEach(p => {
        let isMe = p.id === socket.id ? 'background: rgba(6, 182, 212, 0.2);' : '';
        lbHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); ${isMe}">
                <td style="padding: 12px; font-weight: 900; color: #06b6d4; font-family: monospace; font-size: 1.2rem;">#${p.rank}</td>
                <td style="padding: 12px; font-weight: bold; color: white;">${p.name}</td>
                <td style="padding: 12px; color: #f8fafc;">${Math.round(p.wpm)}</td>
                <td style="padding: 12px; color: #94a3b8;">${Math.round(p.skillScore || 0)}</td>
            </tr>
        `;
    });
    lbBody.innerHTML = lbHtml;

    // Calculate overall session averages for Human Player to save
    let avgWpm = roundCountLogged > 0 ? Math.round(sessionTotalWpmSum / roundCountLogged) : 0;
    const acc = Math.max(0, Math.round(((totalKeystrokes - errors) / Math.max(1, totalKeystrokes)) * 100)) || 0;
    
    // Determine if Player Won the match
    let myFinalData = data.leaderboard.find(p => p.id === socket.id);
    let myRank = myFinalData ? myFinalData.rank : 10;
    
    document.getElementById('save-status').innerText = "Encrypting Dossier Logs...";

    try {
        const res = await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            // CRITICAL: We pass 1 point if the player achieved Rank #1
            body: JSON.stringify({ gameMode: 'neonRoyale', wpm: avgWpm, accuracy: acc, burstSpeed: peakBurstWPM, score: myRank === 1 ? 1 : 0 })
        });
        const finalData = await res.json();
        document.getElementById('save-status').innerText = `Logs Synced! New Skill Score: ${finalData.newSkillScore || 'Updated'}`;
        document.getElementById('save-status').style.color = "#10b981";
    } catch (err) { 
        document.getElementById('save-status').innerText = "Offline: Stats not saved."; 
        document.getElementById('save-status').style.color = "#ef4444"; 
    }
});

// --- ANTI-CHEAT ---
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        document.getElementById('room-code-input').value = roomFromUrl.toUpperCase();
        joinExistingRoom();
    }

    const textWindow = document.getElementById('text-window');
    if (textWindow) {
        textWindow.style.userSelect = 'none'; textWindow.style.webkitUserSelect = 'none';
        textWindow.addEventListener('copy', e => e.preventDefault());
        textWindow.addEventListener('contextmenu', e => e.preventDefault());
    }

    const typeInput = document.getElementById('hidden-type-input');
    if (typeInput) {
        typeInput.addEventListener('paste', e => e.preventDefault());
        typeInput.addEventListener('drop', e => e.preventDefault());
    }
});