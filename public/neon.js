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

// --- 0. FETCH GLOBAL LEADERBOARDS ---
async function fetchLeaderboards() {
    try {
        const res = await fetch('/api/leaderboards');
        const data = await res.json();
        let html = '';
        data.forEach((user, index) => {
            const stats = user.games && user.games.neonRoyale ? user.games.neonRoyale : { played: 0, wins: 0 };
            const played = stats.played;
            const wins = stats.wins;
            const ratio = played > 0 ? Math.round((wins / played) * 100) : 0;
            
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); background: ${index % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent'};">
                    <td style="padding: 12px; font-weight: bold; color: white;">${user.gamertag}</td>
                    <td style="padding: 12px; color: #06b6d4; font-weight: 900;">${user.skillScore || 0}</td>
                    <td style="padding: 12px; color: #cbd5e1; text-align: center;">${played}</td>
                    <td style="padding: 12px; color: #10b981; text-align: center;">${ratio}%</td>
                </tr>
            `;
        });
        document.getElementById('leaderboard-body').innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No pilots found.</td></tr>';
    } catch(e) {
        console.error("Leaderboard error:", e);
        document.getElementById('leaderboard-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444; padding: 20px;">Error loading leaderboard.</td></tr>';
    }
}

// --- 1. LOBBY & INITIALIZATION ---
function hostRoom() {
    isHost = true;
    const roomSize = parseInt(document.getElementById('room-size').value) || 10;
    socket.emit('createRoom', { name: playerName, gameMode: 'neonRoyale', roomSize: roomSize });
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
    document.getElementById('max-player-count').innerText = data.roomSize || 10;
    
    const shareableLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
    document.getElementById('display-room-link').value = shareableLink;
    
    window.history.pushState({ room: currentRoomCode }, '', `?room=${currentRoomCode}`);
    localStorage.setItem('activeRoomUrl', window.location.href);
});

socket.on('roomJoinedSuccess', (data) => {
    currentRoomCode = data.roomCode;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'block';

    document.getElementById('display-room-code').value = currentRoomCode;
    document.getElementById('max-player-count').innerText = data.roomSize || 10;

    const shareableLink = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
    document.getElementById('display-room-link').value = shareableLink;

    window.history.pushState({ room: currentRoomCode }, '', `?room=${currentRoomCode}`);
    localStorage.setItem('activeRoomUrl', window.location.href);
});

socket.on('roomError', (msg) => {
    const errObj = document.getElementById('room-error');
    errObj.innerText = msg; errObj.style.display = 'block';
    if (msg.includes('not found') || msg.includes('expired') || msg.includes('progress') || msg.includes('full')) {
        localStorage.removeItem('activeRoomUrl');
    }
});

socket.on('playerJoinedLobby', (data) => {
    const list = document.getElementById('lobby-player-list');
    document.getElementById('player-count').innerText = data.players.length;
    list.innerHTML = data.players.map(p => `<li class="lobby-player-item">${p.name}</li>`).join('');
    
    if (isHost && data.players.length >= 1) {
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('waiting-msg').style.display = 'none';
    }
});

function startNeonMatch() {
    const diff = document.getElementById('bot-difficulty').value;
    socket.emit('startNeonRoyale', { roomCode: currentRoomCode, botDifficulty: diff });
}

// --- 2. MATCH & ROUND LOOP ---
socket.on('neonGameStarting', () => {
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex';

    const overlay = document.getElementById('neon-timer-overlay');
    if(overlay) {
        overlay.innerText = '5';
        overlay.style.display = 'block';
    }
    document.getElementById('typing-console').style.background = 'transparent';
    document.getElementById('typing-console').style.opacity = '0.2';
    document.getElementById('player-grid').style.opacity = '0.2';
});

socket.on('neonCountdownTick', (data) => {
    const overlay = document.getElementById('neon-timer-overlay');
    if(!overlay) return;
    if(data.timer > 0) {
        overlay.innerText = data.timer;
    } else {
        overlay.innerText = 'GO!';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    }
});

socket.on('neonRoundStart', (data) => {
    document.getElementById('intermission-overlay').style.display = 'none';
    document.getElementById('neon-timer-overlay').style.display = 'none';
    document.getElementById('typing-console').style.opacity = '1';
    document.getElementById('player-grid').style.opacity = '1';

    document.getElementById('round-display').innerText = `ROUND ${data.round}`;
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
        document.getElementById('live-typing-display').style.display = 'flex';
        document.getElementById('words-left-container').style.display = 'block';
        enableKeyboard();
    } else {
        isPlaying = false; // SPECTATOR MODE
        document.getElementById('hidden-type-input').disabled = true;
        document.getElementById('live-typing-display').style.display = 'none';
        document.getElementById('words-left-container').style.display = 'none';
    }
    
    document.getElementById('words-left-count').innerText = targetWords.length;
    renderText();
    updateGrid();
});

// --- 3. DYNAMIC PLAYER GRID ENGINE ---
function getAvatar(player) {
    let seed = player.isBot ? player.name : `Bot${player.name}`;
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
}

function updateGrid() {
    const grid = document.getElementById('player-grid');
    let html = '';
    
    let survivorList = activeSurvivors.map(id => playersState[id]);
    let eliminatedList = Object.values(playersState).filter(p => !activeSurvivors.includes(p.id));
    
    survivorList.sort((a,b) => {
        if (a.progress !== b.progress) return b.progress - a.progress;
        return b.wpm - a.wpm;
    });
    
    eliminatedList.sort((a,b) => (b.rank || 10) - (a.rank || 10));
    
    survivorList.forEach((p, index) => {
        const rank = index + 1;
        const isMe = p.id === socket.id ? 'is-me' : '';
        const isDanger = (rank === survivorList.length && survivorList.length > 1) ? 'danger-zone' : '';
        
        const wordsCount = targetWords.length ? Math.floor(p.progress * targetWords.length) : 0;
        const wordsBadgeHtml = !isPlaying ? `<div class="words-badge">${wordsCount}/${targetWords.length} W</div>` : '';
        
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
                ${wordsBadgeHtml}
                <div class="wpm-badge">${Math.round(p.wpm)} WPM</div>
            </div>
        `;
    });
    
    eliminatedList.forEach(p => {
        const isMe = p.id === socket.id ? 'is-me' : '';
        const wordsCount = targetWords.length ? Math.floor(p.progress * targetWords.length) : 0;
        const wordsBadgeHtml = !isPlaying ? `<div class="words-badge">${wordsCount}/${targetWords.length} W</div>` : '';

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
                ${wordsBadgeHtml}
                <div class="wpm-badge">${Math.round(p.wpm)} WPM</div>
            </div>
        `;
    });
    
    grid.innerHTML = html;
}

socket.on('neonTimerTick', (data) => { document.getElementById('timer-display').innerText = data.timer; });
socket.on('neonBotUpdate', (data) => { playersState = data.players; updateGrid(); });

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
    
    if (playersState[socket.id]) {
        sessionTotalWpmSum += playersState[socket.id].wpm;
        roundCountLogged++;
    }

    if (data.eliminated.id === socket.id) {
        isPlaying = false; // Swapping to Spectator Mode
        document.getElementById('hidden-type-input').disabled = true;
        document.getElementById('live-typing-display').style.display = 'none';
        document.getElementById('words-left-container').style.display = 'none';
        renderText(); 
    }
    
    const overlay = document.getElementById('intermission-overlay');
    document.getElementById('intermission-subtitle').innerText = `${data.eliminated.name} ELIMINATED`;
    document.getElementById('intermission-timer').innerText = "5";
    overlay.style.display = 'flex';
    
    updateGrid();
});

socket.on('neonIntermissionTick', (data) => {
    document.getElementById('intermission-timer').innerText = data.timer;
});

// --- 5. TYPING ENGINE & UI RENDER ---
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

    if (!currentWord.startsWith(val.trim())) {
        currentWordEl.classList.add('error'); 
        liveBox.style.borderColor = '#ef4444'; liveBox.style.color = '#ef4444';
        errors++;
    } else {
        currentWordEl.classList.remove('error');
        liveBox.style.borderColor = '#06b6d4'; liveBox.style.color = 'white';
    }

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
        if (isPlaying) {
            if (i < currentWordIndex) classes.push('correct');
            else if (i === currentWordIndex) classes.push('current');
        } else {
            classes.push('spectator-word');
        }
        return `<span class="${classes.join(' ')}" id="word-${i}">${w}</span>`; 
    }).join("");
    
    document.getElementById('text-content').innerHTML = html;
    
    if (isPlaying) {
        updateScroll(); 
        document.getElementById('text-window').style.height = '3.6em';
        document.getElementById('text-window').style.overflow = 'hidden';
        document.getElementById('text-window').style.overflowY = 'hidden';
    } else {
        // SPECTATOR SCROLL EXPANSION
        document.getElementById('text-content').style.transform = `translateY(0px)`;
        document.getElementById('text-window').style.height = 'auto';
        document.getElementById('text-window').style.maxHeight = '220px';
        document.getElementById('text-window').style.overflowY = 'auto';
    }
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

    let avgWpm = roundCountLogged > 0 ? Math.round(sessionTotalWpmSum / roundCountLogged) : 0;
    const acc = Math.max(0, Math.round(((totalKeystrokes - errors) / Math.max(1, totalKeystrokes)) * 100)) || 0;
    
    let myFinalData = data.leaderboard.find(p => p.id === socket.id);
    let myRank = myFinalData ? myFinalData.rank : (document.getElementById('room-size').value || 10);
    
    document.getElementById('save-status').innerText = "Encrypting Dossier Logs...";

    try {
        const res = await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
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

// --- UTILS & ANTI-CHEAT ---
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function copyData(id) { 
    const c = document.getElementById(id); c.select(); document.execCommand('copy'); 
    const toast = document.getElementById('copy-toast'); toast.innerText = "Copied!";
    toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2000);
}

window.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboards(); // Init Leaderboard

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