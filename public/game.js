const socket = io();
let playerName = localStorage.getItem('gamertag') || "PLAYER";
let currentRoomCode = null;
let isRacing = false;
let hasFinished = false; 
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

// TRACK HAZARDS
let hazardIndices = new Set();
let currentWordHazardFailed = false;
let activePenaltyUntil = 0;

// PARALLAX ANIMATION HANDLES
let skyAnim, cityAnim, roadAnim;

// --- DOM BASED RENDER LOOP ---
function initAnimations() {
    const sky = document.getElementById('bg-sky');
    const city = document.getElementById('bg-city');
    const road = document.getElementById('bg-road');

    if(!skyAnim) {
        skyAnim = sky.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '-1000px 0px' }], { duration: 60000, iterations: Infinity });
        cityAnim = city.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '-2000px 0px' }], { duration: 20000, iterations: Infinity });
        roadAnim = road.animate([{ backgroundPosition: '0px 0px' }, { backgroundPosition: '-2000px 0px' }], { duration: 4000, iterations: Infinity });
        requestAnimationFrame(gameLoop);
    }

    skyAnim.playbackRate = 0; cityAnim.playbackRate = 0; roadAnim.playbackRate = 0;
}

function gameLoop() {
    if (isRacing) {
        const p1El = document.getElementById('p1-car');
        const p2El = document.getElementById('p2-car');
        
        p1El.style.left = `calc(5vw + ${latestMyProgress * 80}vw)`;
        p2El.style.left = `calc(5vw + ${latestOpponentProgress * 80}vw)`;

        // Calculate active hazard physics (Visuals ONLY, WPM is pure math now)
        let hazardSpeedMultiplier = 1;
        if (Date.now() < activePenaltyUntil) {
            hazardSpeedMultiplier = 0.2; // Visual slow down for spin out
        }

        displayMyWPM += (currentWPM - displayMyWPM) * 0.1;
        displayOppWPM += (opponentWPM - displayOppWPM) * 0.1;

        document.getElementById('p1-wpm-tag').innerText = Math.round(displayMyWPM) + ' WPM';
        document.getElementById('p2-wpm-tag').innerText = Math.round(displayOppWPM) + ' WPM';

        const visualNitroBoost = document.getElementById('p1-car').classList.contains('nitro-active') ? 2.5 : 1;
        const targetRate = currentWPM > 0 ? (0.3 + (currentWPM / 60)) * visualNitroBoost * hazardSpeedMultiplier : 0;
        
        cityAnim.playbackRate += (targetRate - cityAnim.playbackRate) * 0.1;
        roadAnim.playbackRate += (targetRate - roadAnim.playbackRate) * 0.1;
        skyAnim.playbackRate = cityAnim.playbackRate * 0.5;
    } else if (skyAnim) {
        cityAnim.playbackRate *= 0.9; roadAnim.playbackRate *= 0.9; skyAnim.playbackRate *= 0.9;
    }
    requestAnimationFrame(gameLoop);
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
    setupGameScreen(data);
    const playersArray = Array.isArray(data.players) ? data.players : Object.values(data.players);
    const me = playersArray.find(p => p.name === playerName);
    const opp = playersArray.find(p => p.name !== playerName);
    
    if (me) { currentWordIndex = Math.round(me.progress * words.length); latestMyProgress = me.progress; currentWPM = me.wpm; }
    if (opp) { latestOpponentProgress = opp.progress; opponentWPM = opp.wpm; }
    if (opp && opp.wpm > 100) document.getElementById('p2-car').classList.add('nitro-active'); 
    
    hasFinished = false; isRacing = true; totalTyped = 0; startTime = Date.now(); lastWordCompleteTime = Date.now();
    consecutiveCorrectWords = 0; currentWordErrors = 0; 
    currentWordHazardFailed = false; activePenaltyUntil = 0; 
    
    generateHazards(); // Regenerate hazards based on the word length
    
    document.getElementById('timer-overlay').style.display = 'none';
    document.getElementById('words-left-count').innerText = words.length - currentWordIndex;
    
    renderText(); enableKeyboard();
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
    let nextHazard = 5 + Math.floor(Math.random() * 5); // Skip the very first words
    while (nextHazard < words.length - 2) {
        hazardIndices.add(nextHazard);
        nextHazard += 8 + Math.floor(Math.random() * 7); // A hazard roughly every 8 to 14 words
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
    hasFinished = false; isRacing = true; startTime = Date.now(); lastWordCompleteTime = Date.now();
    totalTyped = 0; currentWordIndex = 0; latestMyProgress = 0; latestOpponentProgress = 0; 
    currentWPM = 0; opponentWPM = 0; consecutiveCorrectWords = 0; currentWordErrors = 0;
    
    currentWordHazardFailed = false;
    activePenaltyUntil = 0;
    
    displayMyWPM = 0; 
    displayOppWPM = 0; 
    
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
    void el.offsetWidth; // Clean animation reset
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

    // --- TYPO DETECTED ---
    if (!currentWord.startsWith(val.trim())) {
        currentWordEl.classList.add('error'); currentWordEl.classList.remove('active');
        liveBox.style.borderColor = '#ef4444'; liveBox.style.color = '#ef4444';
        
        currentWordErrors++;
        consecutiveCorrectWords = 0; 
        document.getElementById('p1-car').classList.remove('nitro-active');
        isNitroActive = false;

        // THE SPIN-OUT HAZARD PENALTY!
        if (hazardIndices.has(currentWordIndex) && !currentWordHazardFailed) {
            currentWordHazardFailed = true;
            activePenaltyUntil = Date.now() + 1000; 
            
            // STRICT PENALTY: Push progress back by 3 words!
            const wordsToDrop = Math.min(3, currentWordIndex);
            for (let i = 0; i < wordsToDrop; i++) {
                currentWordIndex--;
                totalTyped -= (words[currentWordIndex].length + 1);
            }
            currentWordHazardFailed = false; // Reset to allow re-attempt

            document.getElementById('race-track').classList.add('spin-out');
            setTimeout(() => document.getElementById('race-track').classList.remove('spin-out'), 500);
            showGameplayEvent("💥 SPIN OUT! (-3 WORDS)", "#ef4444");
            
            // Re-render UI to show physical penalty
            e.target.value = ""; 
            liveBox.innerText = "";
            renderText(); 
            
            // Recalculate WPM immediately to reflect lost progress
            const timeElapsed = Math.max(0.1, (Date.now() - startTime) / 60000); 
            currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;
            latestMyProgress = currentWordIndex / words.length;
            
            socket.emit('updateProgress', { roomCode: currentRoomCode, name: playerName, progress: latestMyProgress, wpm: currentWPM });
            return; // Halt logic to let user recover
        }

    // --- TYPING IS CORRECT ---
    } else {
        currentWordEl.classList.remove('error'); currentWordEl.classList.add('active');
        liveBox.style.borderColor = isNitroActive ? '#3b82f6' : '#64748b'; liveBox.style.color = 'white';
    }

    // --- WORD IS COMPLETED ---
    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            let now = Date.now(); let wordTimeMins = Math.max(0.001, (now - lastWordCompleteTime) / 60000);
            let wordBurstWPM = Math.round((currentWord.length / 5) / wordTimeMins);
            if (wordBurstWPM > peakBurstWPM && wordBurstWPM < 300) peakBurstWPM = wordBurstWPM;
            lastWordCompleteTime = now; 
            
            totalTyped += currentWord.length + 1; 
            let wordJumpBonus = 0; // Words to skip
            
            // Nitro Trigger
            if (currentWordErrors === 0) {
                consecutiveCorrectWords++;
                if (consecutiveCorrectWords > 0 && consecutiveCorrectWords % 5 === 0) {
                    isNitroActive = true;
                    document.getElementById('p1-car').classList.add('nitro-active');
                    showGameplayEvent("🚀 NITRO BOOST! (+1 WORD)", "#3b82f6"); 
                    wordJumpBonus += 1;
                }
            } else {
                consecutiveCorrectWords = 0; currentWordErrors = 0;
            }

            // Hazard Cleared Trigger
            if (hazardIndices.has(currentWordIndex)) {
                if (!currentWordHazardFailed) {
                    showGameplayEvent("⚡ HAZARD CLEARED! (+2 WORDS)", "#facc15");
                    wordJumpBonus += 2;
                }
                currentWordHazardFailed = false; 
            }

            // Clear current word UI
            currentWordEl.classList.remove('current', 'active', 'error'); currentWordEl.classList.add('correct');
            currentWordIndex++; e.target.value = ""; liveBox.innerText = "";
            
            // APPLY JUMP BONUSES (Skips words in the array and counts them as typed)
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

            // Pure WPM Recalculation (No artificial multipliers!)
            const timeElapsed = Math.max(0.1, (Date.now() - startTime) / 60000);
            currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;
            
            document.getElementById('words-left-count').innerText = Math.max(0, words.length - currentWordIndex);
            
            if (currentWordIndex < words.length) {
                const nextWordEl = document.getElementById(`word-${currentWordIndex}`);
                if (nextWordEl) nextWordEl.classList.add('current');
            }
            
            latestMyProgress = currentWordIndex / words.length;
            socket.emit('updateProgress', { roomCode: currentRoomCode, name: playerName, progress: latestMyProgress, wpm: currentWPM });
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
    latestOpponentProgress = data.progress; opponentWPM = data.wpm;
    if (data.wpm > 100) document.getElementById('p2-car').classList.add('nitro-active');
    else document.getElementById('p2-car').classList.remove('nitro-active');

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
    document.getElementById('hidden-type-input').disabled = true;
    localStorage.removeItem('activeRoomUrl');

    if(skyAnim) { cityAnim.playbackRate = 0; roadAnim.playbackRate = 0; skyAnim.playbackRate = 0; }

    const time = Math.max(0.1, (Date.now() - startTime) / 60000);
    const wpm = Math.round((totalTyped / 5) / time) || 0;
    const acc = Math.max(0, Math.round(((totalKeystrokes - errors) / Math.max(1, totalKeystrokes)) * 100)) || 0;

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
}

socket.on('opponentDisconnected', (data) => {
    document.getElementById('connection-alert').innerText = `${data.name} DISCONNECTED. WAITING 60s FOR RECONNECT...`;
    document.getElementById('connection-alert').style.display = 'block';
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

    // --- ANTI-CHEAT MECHANISMS ---
    // 1. Prevent text selection, right-clicks, and copying from the paragraph
    const textWindow = document.getElementById('text-window');
    if (textWindow) {
        textWindow.style.userSelect = 'none';
        textWindow.style.webkitUserSelect = 'none';
        textWindow.addEventListener('copy', e => e.preventDefault());
        textWindow.addEventListener('contextmenu', e => e.preventDefault());
    }

    // 2. Prevent pasting or dropping text directly into the typing input
    const typeInput = document.getElementById('hidden-type-input');
    if (typeInput) {
        typeInput.addEventListener('paste', e => e.preventDefault());
        typeInput.addEventListener('drop', e => e.preventDefault());
    }
});