const socket = io();
let playerName = localStorage.getItem('gamertag') || "HACKER";
let currentRoomCode = null, isHacking = false, hasFinished = false, startTime = 0;
let targetSnippet = "", currentIndex = 0;
let totalKeystrokes = 0, errors = 0, lastCharTime = 0, peakBurstWPM = 0;

// TUG OF WAR STATE
let amIPlayer1 = false;
let isLocked = false; 

function hostRoom() { 
    const lang = document.getElementById('language-select').value;
    socket.emit('createRoom', { name: playerName, gameMode: 'syntaxArena', language: lang }); 
}

function joinExistingRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length < 5) return; 
    currentRoomCode = code;
    const lang = document.getElementById('language-select').value;
    socket.emit('joinRoom', { name: playerName, roomCode: code, language: lang });
}

function surrenderMatch() {
    socket.emit('leaveRoom', { roomCode: currentRoomCode });
    localStorage.removeItem('activeRoomUrl');
    document.getElementById('leave-modal').style.display = 'none';
    if (document.getElementById('game-ui').style.display === 'flex') finishHack(false, "Hack Aborted.");
    else window.location.href = 'hub.html';
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
    if (msg.includes('not found') || msg.includes('expired') || msg.includes('full') || msg.includes('already')) localStorage.removeItem('activeRoomUrl');
});

socket.on('syntaxMatchFound', (data) => {
    localStorage.setItem('activeRoomUrl', window.location.href);
    document.getElementById('end-screen').style.display = 'none';
    setupGameScreen(data); startCountdown();
});

socket.on('rejoinSuccess', (data) => {
    localStorage.setItem('activeRoomUrl', window.location.href);
    setupGameScreen(data);
    
    hasFinished = false; isHacking = true; startTime = Date.now(); lastCharTime = Date.now();
    totalKeystrokes = 0; errors = 0; isLocked = false;
    
    renderCode();
    document.getElementById('timer-overlay').style.display = 'none'; enableHackingInput();
});

function getFileExtension(lang) {
    const map = { 'JavaScript': 'js', 'Python': 'py', 'C++': 'cpp', 'Java': 'java', 'Rust': 'rs' };
    return map[lang] || 'txt';
}

function setupGameScreen(data) {
    if (!data.snippet) return; 
    document.getElementById('waiting-screen').style.display = 'none'; document.getElementById('ui-container').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex'; 
    document.getElementById('room-code-display').innerText = 'ROOM: ' + currentRoomCode;
    
    // Set Language Display Header
    document.getElementById('language-display').innerText = `payload.${getFileExtension(data.selectedLanguage)} - VS Code`;

    const playersArray = Array.isArray(data.players) ? data.players : Object.values(data.players);
    const opponent = playersArray.find(p => p.name !== playerName);
    document.getElementById('vs-header').innerText = `${playerName} VS ${opponent ? opponent.name : 'OPPONENT'}`;
    
    // Determine tug-of-war orientation
    amIPlayer1 = playersArray[0].name === playerName;
    if (amIPlayer1) {
        document.getElementById('p1-tug-label').innerText = "YOU";
        document.getElementById('p2-tug-label').innerText = "ENEMY";
    } else {
        document.getElementById('p1-tug-label').innerText = "ENEMY";
        document.getElementById('p2-tug-label').innerText = "YOU";
    }
    
    targetSnippet = data.snippet; 
    currentIndex = 0;
    renderCode();
}

function startCountdown() {
    let count = 3; const overlay = document.getElementById('timer-overlay'); 
    if (overlay) overlay.style.display = 'block';
    
    const timer = setInterval(() => {
        if (overlay) overlay.innerText = count > 0 ? count : "HACK!"; 
        count--;
        if (count < -1) { 
            clearInterval(timer); 
            if (overlay) overlay.style.display = 'none'; 
            beginHack(); 
        }
    }, 1000);
}

function beginHack() {
    hasFinished = false; isHacking = true; isLocked = false; 
    startTime = Date.now(); lastCharTime = Date.now();
    totalKeystrokes = 0; errors = 0; currentIndex = 0; 
    
    // Reset Data Core Visually
    document.getElementById('data-core').style.left = '50%';
    
    renderCode(); enableHackingInput();
}

function enableHackingInput() {
    const input = document.getElementById('hidden-input');
    input.disabled = false; input.value = targetSnippet.substring(0, currentIndex); input.focus();
    document.removeEventListener('click', forceFocus); document.addEventListener('click', forceFocus);
    input.removeEventListener('input', handleHacking); input.addEventListener('input', handleHacking);
}
function forceFocus() { document.getElementById('hidden-input').focus(); }

function triggerSystemShock() {
    isLocked = true;
    const terminal = document.getElementById('terminal-window');
    const input = document.getElementById('hidden-input');
    
    terminal.classList.add('system-shock');
    input.blur(); // Drop focus momentarily to interrupt flow
    
    setTimeout(() => {
        isLocked = false;
        terminal.classList.remove('system-shock');
        if (isHacking) input.focus();
    }, 1000); // 1-Second Penalty Lockout!
}

function handleHacking(e) {
    if (!isHacking || isLocked) return; 
    totalKeystrokes++; 
    
    const input = e.target; const expectedChar = targetSnippet[currentIndex];
    
    // Prevent backspacing past current progress
    if (input.value.length < currentIndex) { 
        input.value = targetSnippet.substring(0, currentIndex);
        return; 
    }
    
    // Evaluate Typed Character
    if (input.value[currentIndex] === expectedChar) {
        // Burst WPM Math
        let now = Date.now(); let charTimeMins = Math.max(0.001, (now - lastCharTime) / 60000);
        let currentBurstWPM = Math.round((1 / 5) / charTimeMins);
        if (currentBurstWPM > peakBurstWPM && currentBurstWPM < 300) peakBurstWPM = currentBurstWPM;
        lastCharTime = now;

        currentIndex++; 
        
        // Push Keystroke to the Physics Engine!
        socket.emit('syntaxKeystroke', { roomCode: currentRoomCode, name: playerName });

        // Endless Code Stream Logic (Loop the chunk instantly)
        if (currentIndex >= targetSnippet.length) { 
            currentIndex = 0;
            input.value = "";
        }
    } else { 
        errors++; 
        input.value = targetSnippet.substring(0, currentIndex); // Block wrong character visually
        triggerSystemShock(); // Punish the player!
    }
    renderCode();
}

// LIVE PHYSICS ENGINE SYNC
socket.on('syntaxCoreUpdate', (data) => {
    const core = document.getElementById('data-core');
    if (core) {
        // data.corePosition ranges from -100 to 100
        // Map it directly to left % (0% to 100%)
        let percent = (data.corePosition + 100) / 2;
        core.style.left = `${percent}%`;
    }
});

socket.on('syntaxMatchEnded', (data) => {
    if (isHacking) finishHack(data.winner === playerName);
});

// Syntax Highlighter Utilities
function escapeHTML(char) {
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '&') return '&amp;';
    return char;
}

function getCharClass(char) {
    if (/[{}\(\)\[\];=<>+\-*/]/.test(char)) return 'symbol';
    if (/[0-9]/.test(char)) return 'number';
    if (/['"`]/.test(char)) return 'string';
    return '';
}

function updateScroll() {
    const container = document.getElementById('typing-box');
    const currentEl = document.querySelector('.char.current');
    if (currentEl && container) {
        container.scrollTop = currentEl.offsetTop - (container.clientHeight / 2);
    }
}

function renderCode() {
    const codeDisplay = document.getElementById('target-code'); let html = "";
    for (let i = 0; i < targetSnippet.length; i++) {
        let char = targetSnippet[i]; 
        let displayChar = char === '\n' ? '↵\n' : escapeHTML(char); 
        
        if (i < currentIndex) {
            html += `<span class="char typed">${displayChar}</span>`;
        } else if (i === currentIndex) {
            html += `<span class="char current">${displayChar}</span>`;
        } else {
            let syntaxClass = getCharClass(char);
            html += `<span class="char untyped ${syntaxClass}">${displayChar}</span>`;
        }
    }
    codeDisplay.innerHTML = html;
    updateScroll();
}

async function finishHack(isWinner, customMsg = null) {
    if (hasFinished) return;
    hasFinished = true; isHacking = false; isLocked = false;
    document.getElementById('hidden-input').disabled = true; localStorage.removeItem('activeRoomUrl');
    
    document.getElementById('terminal-window').classList.remove('system-shock');

    const timeMins = Math.max(0.1, (Date.now() - startTime) / 60000);
    // Rough estimate of effective WPM during the tug of war
    const finalWpm = Math.round((totalKeystrokes / 5) / timeMins) || 0;
    const finalAcc = Math.max(0, Math.round(((totalKeystrokes - errors) / Math.max(1, totalKeystrokes)) * 100)) || 0;

    document.getElementById('game-ui').style.display = 'flex'; 
    const endModal = document.getElementById('end-screen'); 
    endModal.style.display = 'flex';

    const banner = document.getElementById('result-banner');
    banner.innerText = isWinner ? "SYSTEM COMPROMISED" : "CONNECTION SEVERED";
    banner.style.color = isWinner ? "#10b981" : "#ef4444";
    
    document.getElementById('final-wpm').innerText = finalWpm;
    document.getElementById('final-acc').innerText = finalAcc;

    if (customMsg) document.getElementById('save-status').innerText = customMsg + " Encrypting Logs...";
    else document.getElementById('save-status').innerText = "Encrypting Logs...";

    try {
        await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ gameMode: 'syntaxArena', wpm: finalWpm, accuracy: finalAcc, burstSpeed: peakBurstWPM, score: isWinner ? 1 : 0 })
        });
        document.getElementById('save-status').innerText = customMsg ? customMsg + " (Saved)" : "Logs Synced to Mainframe.";
        document.getElementById('save-status').style.color = "#10b981";
    } catch (err) {
        document.getElementById('save-status').innerText = "Offline: Logs lost.";
        document.getElementById('save-status').style.color = "#ef4444";
    }
}

socket.on('opponentDisconnected', (data) => {
    document.getElementById('connection-alert').innerText = `${data.name} DISCONNECTED. WAITING 60s FOR RECONNECT...`;
    document.getElementById('connection-alert').style.display = 'block';
});
socket.on('opponentReconnected', (data) => { document.getElementById('connection-alert').style.display = 'none'; });

socket.on('forfeitWin', (data) => { finishHack(true, "Opponent Fled."); });

// Seamless Rematch Integration
function requestRematch() {
    const statusEl = document.getElementById('save-status');
    statusEl.innerText = "Awaiting handshake..."; statusEl.style.color = "#3b82f6";
    socket.emit('requestRematch', { roomCode: currentRoomCode, name: playerName });
}

socket.on('rematchRequested', () => {
    const statusEl = document.getElementById('save-status');
    if (statusEl) { statusEl.innerText = "Opponent requests re-engagement!"; statusEl.style.color = "#f59e0b"; }
});

socket.on('rematchGenerating', () => {
    const statusEl = document.getElementById('save-status');
    if (statusEl) { statusEl.innerText = "Compiling new target script..."; statusEl.style.color = "#10b981"; }
});

async function fetchLeaderboards() {
    try {
        const res = await fetch('/api/leaderboards');
        const data = await res.json();
        let html = '';
        data.forEach((user, index) => {
            const stats = user.games && user.games.syntaxArena ? user.games.syntaxArena : { played: 0, wins: 0 };
            const played = stats.played;
            const wins = stats.wins;
            const ratio = played > 0 ? Math.round((wins / played) * 100) : 0;
            
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); background: ${index % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent'};">
                    <td style="padding: 12px; font-weight: bold; color: white;">${user.gamertag}</td>
                    <td style="padding: 12px; color: #10b981; font-weight: 900;">${user.skillScore || 0}</td>
                    <td style="padding: 12px; color: #cbd5e1; text-align: center;">${played}</td>
                    <td style="padding: 12px; color: #3b82f6; text-align: center;">${ratio}%</td>
                </tr>
            `;
        });
        document.getElementById('leaderboard-body').innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No hackers found.</td></tr>';
    } catch(e) {
        document.getElementById('leaderboard-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444; padding: 20px;">Error loading leaderboard.</td></tr>';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboards();
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) { document.getElementById('room-code-input').value = roomFromUrl.toUpperCase(); joinExistingRoom(); }

    // ANTI-CHEAT
    const textWindow = document.getElementById('typing-box');
    if (textWindow) {
        textWindow.style.userSelect = 'none'; textWindow.style.webkitUserSelect = 'none';
        textWindow.addEventListener('copy', e => e.preventDefault()); textWindow.addEventListener('contextmenu', e => e.preventDefault());
    }
    const typeInput = document.getElementById('hidden-input');
    if (typeInput) { typeInput.addEventListener('paste', e => e.preventDefault()); typeInput.addEventListener('drop', e => e.preventDefault()); }
});