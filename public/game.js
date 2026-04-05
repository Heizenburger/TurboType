const socket = io();
let playerName = localStorage.getItem('gamertag') || "PLAYER";
let currentRoomCode = null;
let isRacing = false;
let hasFinished = false; 
let amIWinner = false;
let gameplayEventTimeout;

// --- STAT & GAME TRACKING ---
let targetParagraph = "";
let words = [];
let currentWordIndex = 0;
let startTime = 0, errors = 0, totalTyped = 0, totalKeystrokes = 0, lastWordCompleteTime = 0, peakBurstWPM = 0;

// STATE & MECHANICS
let latestMyProgress = 0, latestOpponentProgress = 0;
let currentWPM = 0, opponentWPM = 0;
let displayMyWPM = 0, displayOppWPM = 0;

let consecutiveCorrectWords = 0;
let currentWordErrors = 0;
let isNitroActive = false;
let opponentNitro = false;
let opponentSpinning = false;

// TRACK HAZARDS
let hazardIndices = new Set();
let currentWordHazardFailed = false;
let activePenaltyUntil = 0;

// ==========================================
// --- NEW PARALLAX ENGINE (PHASES 2-4)   ---
// ==========================================
let bgSpeed = 0;
let p1TireRotation = 0;
let p2TireRotation = 0;
let carBouncePhase = 0;
let currentP1X = 0;
let currentP2X = 0;
let animationFrameId;

const parallaxLayers = [
    { id: 'layer-mountains', mult: 0.1, pos: 0, el: null },
    { id: 'layer-city', mult: 0.35, pos: 0, el: null },
    { id: 'layer-lines', mult: 1.8, pos: 0, el: null }
];

function initAnimations() {
    parallaxLayers.forEach(l => l.el = document.getElementById(l.id));
    if(!animationFrameId) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function gameLoop() {
    if (isRacing) {
        bgSpeed = 25; 

        displayMyWPM += (currentWPM - displayMyWPM) * 0.1;
        displayOppWPM += (opponentWPM - displayOppWPM) * 0.1;

        const p1WpmEl = document.getElementById('p1-wpm-tag');
        const p2WpmEl = document.getElementById('p2-wpm-tag');
        if(p1WpmEl) p1WpmEl.innerText = Math.round(displayMyWPM) + ' WPM';
        if(p2WpmEl) p2WpmEl.innerText = Math.round(displayOppWPM) + ' WPM';

        let hazardSpeedMultiplier = Date.now() < activePenaltyUntil ? 0.2 : 1;
        let p1Speed = (bgSpeed + (currentWPM * 0.1)) * hazardSpeedMultiplier;
        let p2Speed = bgSpeed + (opponentWPM * 0.1);

        p1TireRotation = (p1TireRotation + p1Speed * 4) % 360;
        p2TireRotation = (p2TireRotation + p2Speed * 4) % 360;

        const p1Tires = [document.getElementById('p1-tire-back'), document.getElementById('p1-tire-front')];
        const p2Tires = [document.getElementById('p2-tire-back'), document.getElementById('p2-tire-front')];
        p1Tires.forEach(t => t && (t.style.transform = `rotate(${p1TireRotation}deg)`));
        p2Tires.forEach(t => t && (t.style.transform = `rotate(${p2TireRotation}deg)`));

        carBouncePhase += 0.5;
        const bounceY = Math.sin(carBouncePhase) * 1.2;
        
        // Calculate difference in WPM for immediate physical responsiveness
        let wpmDiff = currentWPM - opponentWPM;
        
        // Calculate difference in actual text progress to ensure the true leader is visually ahead
        let progressDiff = (latestMyProgress - latestOpponentProgress) * 600; 

        // Blend them together and use a wider boundary (-400 to 400)
        // This guarantees the opponent car (starting at 5vw) can bridge the gap and overtake the player (starting at 15vw)
        let combinedDiff = (wpmDiff * 3.5) + progressDiff;
        let cappedDiff = Math.max(-400, Math.min(400, combinedDiff)); 

        let targetP1X = cappedDiff;
        let targetP2X = -cappedDiff;

        if (isNitroActive) targetP1X += 80;
        if (Date.now() < activePenaltyUntil) targetP1X -= 80;

        if (opponentNitro) targetP2X += 80;
        if (opponentSpinning) targetP2X -= 80;

        currentP1X += (targetP1X - currentP1X) * 0.05;
        currentP2X += (targetP2X - currentP2X) * 0.05;

        const p1Container = document.getElementById('p1-car');
        const p2Container = document.getElementById('p2-car');
        
        if (p1Container) p1Container.style.transform = `translate(${currentP1X}px, ${bounceY}px)`;
        if (p2Container) p2Container.style.transform = `translate(${currentP2X}px, ${bounceY * 0.8}px)`;

        if (isNitroActive && p1Container) p1Container.classList.add('nitro-active');
        else if (p1Container) p1Container.classList.remove('nitro-active');

        if (opponentNitro && p2Container) p2Container.classList.add('nitro-active');
        else if (p2Container) p2Container.classList.remove('nitro-active');

        parallaxLayers.forEach(layer => {
            if(layer.el) {
                layer.pos -= bgSpeed * layer.mult;
                layer.el.style.backgroundPositionX = `${layer.pos % 10000}px`;
            }
        });

    } else if (hasFinished) {
        bgSpeed *= 0.95; 
        if (bgSpeed < 0.1) bgSpeed = 0;
        
        if (amIWinner) {
            currentP1X += 25; 
            currentP2X -= 15; 
            p1TireRotation = (p1TireRotation + 40) % 360; 
            p2TireRotation = (p2TireRotation + bgSpeed * 4) % 360; 
        } else {
            currentP2X += 25; 
            currentP1X -= 15; 
            p2TireRotation = (p2TireRotation + 40) % 360;
            p1TireRotation = (p1TireRotation + bgSpeed * 4) % 360;
        }

        const p1Container = document.getElementById('p1-car');
        const p2Container = document.getElementById('p2-car');
        let finishBounceY = bgSpeed > 5 ? Math.sin(carBouncePhase) * 1.2 : 0;

        if (p1Container) p1Container.style.transform = `translate(${currentP1X}px, ${finishBounceY}px)`;
        if (p2Container) p2Container.style.transform = `translate(${currentP2X}px, ${finishBounceY * 0.8}px)`;

        if (isNitroActive && p1Container) p1Container.classList.add('nitro-active');
        else if (p1Container) p1Container.classList.remove('nitro-active');

        if (opponentNitro && p2Container) p2Container.classList.add('nitro-active');
        else if (p2Container) p2Container.classList.remove('nitro-active');

        const p1Tires = [document.getElementById('p1-tire-back'), document.getElementById('p1-tire-front')];
        const p2Tires = [document.getElementById('p2-tire-back'), document.getElementById('p2-tire-front')];
        p1Tires.forEach(t => t && (t.style.transform = `rotate(${p1TireRotation}deg)`));
        p2Tires.forEach(t => t && (t.style.transform = `rotate(${p2TireRotation}deg)`));

        parallaxLayers.forEach(layer => {
            if(layer.el) {
                layer.pos -= bgSpeed * layer.mult;
                layer.el.style.backgroundPositionX = `${layer.pos % 10000}px`;
            }
        });
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- ROOM MANAGEMENT ---
function hostRoom() {
    const len = parseInt(document.getElementById('race-length').value);
    socket.emit('createRoom', { name: playerName, gameMode: 'turboRacing', length: len });
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
    document.getElementById('leave-modal').style.display = 'none';
    
    if (document.getElementById('game-ui').style.display === 'flex') {
        finishRace(false, "You abandoned the race.");
    } else {
        window.location.href = 'hub.html';
    }
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
    if (msg.includes('not found') || msg.includes('expired') || msg.includes('full') || msg.includes('already')) {
        localStorage.removeItem('activeRoomUrl');
    }
});

socket.on('matchStart', (data) => {
    localStorage.setItem('activeRoomUrl', window.location.href);
    document.getElementById('end-screen').style.display = 'none';
    setupGameScreen(data); startCountdown();
});

socket.on('rejoinSuccess', (data) => {
    localStorage.setItem('activeRoomUrl', window.location.href);
    document.getElementById('end-screen').style.display = 'none'; // FIX: Ensures modal closes for rematch!
    
    setupGameScreen(data);
    
    // Ensure everything resets correctly and the cars sit back at the start line
    isRacing = false;
    currentP1X = 0; currentP2X = 0;
    
    const p1Container = document.getElementById('p1-car');
    const p2Container = document.getElementById('p2-car');
    if (p1Container) { p1Container.classList.remove('nitro-active'); p1Container.style.transform = `translate(0px, 0px)`; }
    if (p2Container) { p2Container.classList.remove('nitro-active'); p2Container.style.transform = `translate(0px, 0px)`; }
    
    // Trigger the 5 second countdown before the race logic officially triggers
    startCountdown();
});

function setupGameScreen(data) {
    if (!data.text) return; 
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex';
    
    initAnimations(); 

    document.getElementById('room-code-display').innerText = 'ROOM: ' + currentRoomCode;
    const playersArray = Array.isArray(data.players) ? data.players : Object.values(data.players);
    const me = playersArray.find(p => p.name === playerName);
    const opponent = playersArray.find(p => p.name !== playerName);
    
    document.getElementById('vs-header').innerText = `${playerName} VS ${opponent ? opponent.name : 'OPPONENT'}`;
    
    const p1Score = me ? (me.skillScore || 0) : 0;
    const p2Score = opponent ? (opponent.skillScore || 0) : 0;
    
    if (me) document.getElementById('p1-skill-header').innerText = `Score: ${p1Score}`;
    if (opponent) document.getElementById('p2-skill-header').innerText = `Score: ${p2Score}`;
    document.getElementById('header-skill-scores').style.display = 'block';

    const minSkill = Math.min(p1Score, p2Score);
    let diffText = "MEDIUM"; let diffColor = "#f59e0b";
    
    if (minSkill < 250) { diffText = "EASY"; diffColor = "#10b981"; }
    else if (minSkill >= 700) { diffText = "HARD"; diffColor = "#ef4444"; }
    
    document.getElementById('diff-level').innerText = diffText;
    document.getElementById('diff-level').style.color = diffColor;
    document.getElementById('difficulty-display').style.display = 'block';
    
    targetParagraph = data.text; words = targetParagraph.split(" "); currentWordIndex = 0;
    
    generateHazards();
    renderText();
    document.getElementById('words-left-count').innerText = words.length;
}

function generateHazards() {
    hazardIndices.clear();
    let nextHazard = 5 + Math.floor(Math.random() * 5); 
    while (nextHazard < words.length - 2) {
        hazardIndices.add(nextHazard);
        nextHazard += 8 + Math.floor(Math.random() * 7); 
    }
}

function startCountdown() {
    let count = 5;
    const overlay = document.getElementById('timer-overlay'); overlay.style.display = 'block';
    const timer = setInterval(() => {
        overlay.innerText = count; count--;
        if (count < 0) { clearInterval(timer); overlay.style.display = 'none'; beginRace(); }
    }, 1000);
}

function beginRace() {
    hasFinished = false; amIWinner = false; isRacing = true; 
    startTime = Date.now(); lastWordCompleteTime = Date.now();
    totalTyped = 0; currentWordIndex = 0; latestMyProgress = 0; latestOpponentProgress = 0; 
    currentWPM = 0; opponentWPM = 0; consecutiveCorrectWords = 0; currentWordErrors = 0;
    
    currentP1X = 0; currentP2X = 0;
    currentWordHazardFailed = false; activePenaltyUntil = 0;
    
    displayMyWPM = 0; displayOppWPM = 0; 
    isNitroActive = false; opponentNitro = false; opponentSpinning = false;
    
    document.getElementById('p1-car').classList.remove('nitro-active');
    document.getElementById('p2-car').classList.remove('nitro-active'); 
    document.getElementById('live-typing-display').innerText = "";
    document.getElementById('words-left-count').innerText = words.length;
    
    renderText(); enableKeyboard();
}

function enableKeyboard() {
    const input = document.getElementById('hidden-type-input');
    input.value = ""; input.disabled = false; input.focus();
    
    document.removeEventListener('click', forceFocus); document.addEventListener('click', forceFocus);
    input.removeEventListener('input', handleTyping); input.addEventListener('input', handleTyping);
}

function forceFocus() { document.getElementById('hidden-type-input').focus(); }

function showGameplayEvent(text, color) {
    const el = document.getElementById('gameplay-event');
    if (!el) return;
    el.innerText = text;
    el.style.color = color;
    el.style.textShadow = `0 0 15px ${color}`;
    
    el.classList.remove('show');
    void el.offsetWidth; 
    el.classList.add('show');
    
    clearTimeout(gameplayEventTimeout);
    gameplayEventTimeout = setTimeout(() => el.classList.remove('show'), 1500);
}

function handleTyping(e) {
    if (!isRacing) return;
    totalKeystrokes++; 
    
    const val = e.target.value; 
    const currentWord = words[currentWordIndex];
    const currentWordEl = document.getElementById(`word-${currentWordIndex}`);
    const liveBox = document.getElementById('live-typing-display');

    liveBox.innerText = val;

    if (!currentWord.startsWith(val.trim())) {
        currentWordEl.classList.add('error'); currentWordEl.classList.remove('active');
        liveBox.style.borderColor = '#ef4444'; liveBox.style.color = '#ef4444';
        
        currentWordErrors++;
        consecutiveCorrectWords = 0; 
        isNitroActive = false;

        if (hazardIndices.has(currentWordIndex) && !currentWordHazardFailed) {
            currentWordHazardFailed = true;
            activePenaltyUntil = Date.now() + 1000; 
            
            const wordsToDrop = Math.min(3, currentWordIndex);
            for (let i = 0; i < wordsToDrop; i++) {
                currentWordIndex--;
                totalTyped -= (words[currentWordIndex].length + 1);
            }
            currentWordHazardFailed = false;

            document.getElementById('race-track').classList.add('spin-out');
            setTimeout(() => document.getElementById('race-track').classList.remove('spin-out'), 500);
            showGameplayEvent("💥 SPIN OUT! (-3 WORDS)", "#ef4444");
            
            e.target.value = ""; 
            liveBox.innerText = "";
            renderText(); 
            
            const timeElapsed = Math.max(0.1, (Date.now() - startTime) / 60000); 
            currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;
            latestMyProgress = currentWordIndex / words.length;
            
            socket.emit('updateProgress', { roomCode: currentRoomCode, name: playerName, progress: latestMyProgress, wpm: currentWPM, isNitro: isNitroActive, isSpinning: true });
            return; 
        }

    } else {
        currentWordEl.classList.remove('error'); currentWordEl.classList.add('active');
        liveBox.style.borderColor = isNitroActive ? '#3b82f6' : '#64748b'; liveBox.style.color = 'white';
    }

    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            let now = Date.now(); let wordTimeMins = Math.max(0.001, (now - lastWordCompleteTime) / 60000);
            let wordBurstWPM = Math.round((currentWord.length / 5) / wordTimeMins);
            if (wordBurstWPM > peakBurstWPM && wordBurstWPM < 300) peakBurstWPM = wordBurstWPM;
            lastWordCompleteTime = now; 
            
            totalTyped += currentWord.length + 1; 
            let wordJumpBonus = 0; 
            
            if (currentWordErrors === 0) {
                consecutiveCorrectWords++;
                if (consecutiveCorrectWords > 0 && consecutiveCorrectWords % 5 === 0) {
                    isNitroActive = true;
                    showGameplayEvent("🚀 NITRO BOOST! (+1 WORD)", "#3b82f6"); 
                    wordJumpBonus += 1;
                }
            } else {
                consecutiveCorrectWords = 0; currentWordErrors = 0;
            }

            if (hazardIndices.has(currentWordIndex)) {
                if (!currentWordHazardFailed) {
                    showGameplayEvent("⚡ HAZARD CLEARED! (+2 WORDS)", "#facc15");
                    wordJumpBonus += 2;
                }
                currentWordHazardFailed = false; 
            }

            currentWordEl.classList.remove('current', 'active', 'error'); currentWordEl.classList.add('correct');
            currentWordIndex++; e.target.value = ""; liveBox.innerText = "";
            
            for (let i = 0; i < wordJumpBonus; i++) {
                if (currentWordIndex < words.length) {
                    let skippedWord = words[currentWordIndex];
                    let skippedWordEl = document.getElementById(`word-${currentWordIndex}`);
                    if (skippedWordEl) {
                        skippedWordEl.classList.remove('current', 'active', 'error', 'hazard');
                        skippedWordEl.classList.add('correct');
                    }
                    totalTyped += skippedWord.length + 1; 
                    currentWordIndex++;
                }
            }

            const timeElapsed = Math.max(0.1, (Date.now() - startTime) / 60000);
            currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;
            
            document.getElementById('words-left-count').innerText = Math.max(0, words.length - currentWordIndex);
            
            if (currentWordIndex < words.length) {
                const nextWordEl = document.getElementById(`word-${currentWordIndex}`);
                if (nextWordEl) nextWordEl.classList.add('current');
            }
            
            latestMyProgress = currentWordIndex / words.length;
            socket.emit('updateProgress', { roomCode: currentRoomCode, name: playerName, progress: latestMyProgress, wpm: currentWPM, isNitro: isNitroActive, isSpinning: false });
            updateScroll(); 
            
            if (currentWordIndex >= words.length) finishRace(true);
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

socket.on('opponentProgress', (data) => {
    latestOpponentProgress = data.progress; 
    opponentWPM = data.wpm;
    opponentNitro = data.isNitro || false;
    opponentSpinning = data.isSpinning || false;
    
    if (data.progress >= 1 && isRacing) finishRace(false);
});

function renderText() {
    const html = words.map((w, i) => {
        let classes = ['word'];
        if (i < currentWordIndex) classes.push('correct');
        else if (i === currentWordIndex) classes.push('current');
        
        if (hazardIndices.has(i) && i >= currentWordIndex) classes.push('hazard');
        
        return `<span class="${classes.join(' ')}" id="word-${i}">${w}</span>`; 
    }).join("");
    document.getElementById('text-content').innerHTML = html;
    updateScroll(); 
}

async function finishRace(isWinner, customMsg = null) {
    if (hasFinished) return;
    hasFinished = true;
    isRacing = false;
    amIWinner = isWinner;

    if (isWinner) {
        isNitroActive = true;
        opponentNitro = false;
    } else {
        isNitroActive = false;
        opponentNitro = true;
    }

    document.getElementById('hidden-type-input').disabled = true;
    localStorage.removeItem('activeRoomUrl');

    const time = Math.max(0.1, (Date.now() - startTime) / 60000);
    const wpm = Math.round((totalTyped / 5) / time) || 0;
    const acc = Math.max(0, Math.round(((totalKeystrokes - errors) / Math.max(1, totalKeystrokes)) * 100)) || 0;

    setTimeout(async () => {
        document.getElementById('game-ui').style.display = 'flex'; 
        const endModal = document.getElementById('end-screen'); 
        endModal.style.display = 'flex';
        
        document.getElementById('result-banner').innerText = isWinner ? "🏆 VICTORY!" : "🏳️ DEFEAT";
        document.getElementById('result-banner').style.color = isWinner ? "#f59e0b" : "#ef4444";
        
        document.getElementById('final-wpm').innerText = wpm;
        document.getElementById('final-acc').innerText = acc;
        document.getElementById('final-burst').innerText = peakBurstWPM;

        if (customMsg) document.getElementById('save-status').innerText = customMsg + " Saving Data...";
        else document.getElementById('save-status').innerText = "Saving Data...";

        try {
            await fetch('/api/game/end', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ gameMode: 'turboRacing', wpm: wpm, accuracy: acc, burstSpeed: peakBurstWPM, score: isWinner ? 1 : 0 })
            });
            document.getElementById('save-status').innerText = customMsg ? customMsg + " (Saved!)" : "Data Saved to Server!";
            document.getElementById('save-status').style.color = "#10b981";
        } catch (err) { 
            document.getElementById('save-status').innerText = "Offline: Stats not saved."; 
            document.getElementById('save-status').style.color = "#ef4444"; 
        }
    }, 1500); 
}

socket.on('opponentDisconnected', (data) => {
    // If the opponent leaves while the game screen is active and not finished, auto-win!
    if (!hasFinished && document.getElementById('game-ui').style.display === 'flex') {
        finishRace(true, "Opponent abandoned the race.");
        document.getElementById('connection-alert').style.display = 'none';
    } else {
        document.getElementById('connection-alert').innerText = `${data.name} DISCONNECTED.`;
        document.getElementById('connection-alert').style.display = 'block';
    }
});
socket.on('opponentReconnected', (data) => { document.getElementById('connection-alert').style.display = 'none'; });

socket.on('forfeitWin', (data) => {
    finishRace(true, "Opponent fled."); 
});

function requestRematch() {
    const statusEl = document.getElementById('save-status');
    statusEl.innerText = "Waiting for opponent...";
    statusEl.style.color = "#3b82f6";
    socket.emit('requestRematch', { roomCode: currentRoomCode, name: playerName });
}

socket.on('rematchRequested', () => {
    const statusEl = document.getElementById('save-status');
    if (statusEl) {
        statusEl.innerText = "Opponent wants a rematch!";
        statusEl.style.color = "#f59e0b";
    }
});

socket.on('rematchGenerating', () => {
    const statusEl = document.getElementById('save-status');
    if (statusEl) {
        statusEl.innerText = "Generating new track...";
        statusEl.style.color = "#10b981";
    }
});

async function fetchLeaderboards() {
    try {
        const res = await fetch('/api/leaderboards');
        const data = await res.json();
        let html = '';
        data.forEach((user, index) => {
            const stats = user.games && user.games.turboRacing ? user.games.turboRacing : { played: 0, wins: 0 };
            const played = stats.played;
            const wins = stats.wins;
            const ratio = played > 0 ? Math.round((wins / played) * 100) : 0;
            
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); background: ${index % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent'};">
                    <td style="padding: 12px; font-weight: bold; color: white;">${user.gamertag}</td>
                    <td style="padding: 12px; color: #3b82f6; font-weight: 900;">${user.skillScore || 0}</td>
                    <td style="padding: 12px; color: #cbd5e1; text-align: center;">${played}</td>
                    <td style="padding: 12px; color: #10b981; text-align: center;">${ratio}%</td>
                </tr>
            `;
        });
        document.getElementById('leaderboard-body').innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No racers found.</td></tr>';
    } catch(e) {
        console.error("Leaderboard error:", e);
        document.getElementById('leaderboard-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444; padding: 20px;">Error loading leaderboard.</td></tr>';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboards();
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        document.getElementById('room-code-input').value = roomFromUrl.toUpperCase();
        joinExistingRoom();
    }

    const textWindow = document.getElementById('text-window');
    if (textWindow) {
        textWindow.style.userSelect = 'none';
        textWindow.style.webkitUserSelect = 'none';
        textWindow.addEventListener('copy', e => e.preventDefault());
        textWindow.addEventListener('contextmenu', e => e.preventDefault());
    }

    const typeInput = document.getElementById('hidden-type-input');
    if (typeInput) {
        typeInput.addEventListener('paste', e => e.preventDefault());
        typeInput.addEventListener('drop', e => e.preventDefault());
    }
});