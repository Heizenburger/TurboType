const socket = io();
let playerName = localStorage.getItem('gamertag') || "RAIDER";
let currentRoomCode = null, isHost = false, isPlaying = false;
let maxHp = 5000, currentHp = 5000, isEnraged = false;

// Typing State
let originalLoreWords = [];
let loreWords = [];
let currentWordIndex = 0;
let totalDamageDealt = 0; 
let sessionStartTime = 0, sessionKeystrokes = 0, sessionErrors = 0, lastWordTime = 0, peakRaidBurst = 0;

// Surging Combo System
let currentCombo = 0;
let damageMultiplier = 1.0;

let hazardIndices = new Set();
let activePlayers = {}; 

function flashBoss() { 
    const boss = document.getElementById('boss-entity');
    if (!boss) return;
    boss.classList.add('hit-flash'); 
    setTimeout(() => boss.classList.remove('hit-flash'), 100); 
}

function hostRoom() { 
    isHost = true;
    socket.emit('createRoom', { name: playerName, gameMode: 'colosseumRaid' }); 
}

function joinExistingRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length < 5) return; currentRoomCode = code;
    socket.emit('joinRoom', { name: playerName, roomCode: code });
}

function surrenderMatch() {
    socket.emit('leaveRoom', { roomCode: currentRoomCode, name: playerName });
    localStorage.removeItem('activeRoomUrl');
    window.location.href = 'hub.html';
}

socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    window.history.pushState({ room: currentRoomCode }, '', `?room=${currentRoomCode}`);
    localStorage.setItem('activeRoomUrl', 'colosseum.html?room=' + currentRoomCode);
    setupLobby(data);
});

socket.on('raidState', (data) => { 
    localStorage.setItem('activeRoomUrl', 'colosseum.html?room=' + currentRoomCode); 
    setupLobby(data); 
});

socket.on('roomError', (msg) => {
    const errObj = document.getElementById('room-error'); errObj.innerText = msg; errObj.style.display = 'block';
    if (msg.includes('not found') || msg.includes('expired')) localStorage.removeItem('activeRoomUrl');
});

// WAITING LOBBY SETUP
function setupLobby(data) {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'block';
    document.getElementById('ui-container').style.display = 'block'; 
    
    document.getElementById('display-room-code').value = currentRoomCode;

    const origin = (window.location.origin === "null" || !window.location.origin) ? "https://turbotype.app" : window.location.origin;
    const shareableLink = `${origin}${window.location.pathname}?room=${currentRoomCode}`;
    const linkInput = document.getElementById('display-room-link');
    if(linkInput) linkInput.value = shareableLink;

    maxHp = data.boss ? data.boss.maxHp : 5000; 
    updateHealthBar(data.boss ? data.boss.hp : maxHp);
    
    const rawLore = (data.boss && data.boss.activeLore) ? data.boss.activeLore : "The ancient monolithic core pulsates with dark energy. Type to destroy it!";
    originalLoreWords = rawLore.split(" ");
    loreWords = [...originalLoreWords];
    currentWordIndex = 0;
    
    hazardIndices.clear();
    for(let i=0; i<loreWords.length; i++) {
        if (i > 0 && Math.random() < 0.15) hazardIndices.add(i); 
    }

    activePlayers = data.players || {};
    activePlayers[socket.id] = { id: socket.id, name: playerName }; 
    renderLobbyPlayers();

    if (isHost) {
        document.getElementById('start-raid-btn').style.display = 'block';
        document.getElementById('wait-host-msg').style.display = 'none';
    } else {
        document.getElementById('start-raid-btn').style.display = 'none';
        document.getElementById('wait-host-msg').style.display = 'block';
    }

    logMessage(`[SYS] Connected to Raid: [${currentRoomCode}]`);
    document.getElementById('input-field').disabled = true; 
}

function renderLobbyPlayers() {
    const container = document.getElementById('lobby-players');
    if (!container) return;
    container.innerHTML = '';
    Object.values(activePlayers).slice(0, 10).forEach(p => {
        const isMe = p.id === socket.id;
        const initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
        container.innerHTML += `
            <div class="player-avatar ${isMe ? 'me' : ''}" style="position:relative;">
                ${initial}
                <div class="player-name" style="bottom:-25px;">${isMe ? 'YOU' : p.name}</div>
            </div>
        `;
    });
}

function renderGamePlayers() {
    const container = document.getElementById('players-container');
    if (!container) return;
    container.innerHTML = '';
    
    const displayPlayers = Object.values(activePlayers).slice(0, 5); 
    
    displayPlayers.forEach(p => {
        const isMe = p.id === socket.id;
        const initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
        container.innerHTML += `
            <div class="player-avatar ${isMe ? 'me' : ''}" id="avatar-${p.id}">
                ${initial}
                <div class="player-name">${isMe ? 'YOU' : p.name}</div>
            </div>
        `;
    });
}

socket.on('playerJoinedRaid', (data) => { 
    activePlayers[data.id] = { id: data.id, name: data.name };
    if (!isPlaying) renderLobbyPlayers();
    else renderGamePlayers();
    logMessage(`[SYS] ${data.name} breached the arena!`); 
});

socket.on('opponentDisconnected', (data) => { 
    if(activePlayers[data.id]) {
        delete activePlayers[data.id];
        renderLobbyPlayers();
        renderGamePlayers();
    }
    logMessage(`[WARN] ${data.name} lost connection.`); 
});

// --- RAID START LOGIC ---
function startRaid() {
    socket.emit('startColosseumRaid', { roomCode: currentRoomCode });
}

socket.on('colosseumGameStarting', () => {
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('waiting-screen').style.display = 'none';
    
    document.getElementById('game-ui').style.display = 'flex';
    document.getElementById('room-code-display-game').innerText = `ROOM: ${currentRoomCode}`;
    
    renderGamePlayers();
    renderText();
    
    let countdown = 5;
    const overlay = document.getElementById('timer-overlay');
    overlay.style.display = 'block';
    overlay.innerText = countdown;

    const timer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            overlay.innerText = countdown;
        } else {
            clearInterval(timer);
            overlay.style.display = 'none';
            isPlaying = true;
            
            const input = document.getElementById('input-field');
            input.value = "";
            input.disabled = false; 
            input.focus();
            
            logMessage(`[SYS] Weapons hot. Engage the Behemoth!`);
        }
    }, 1000);
});

// --- COMBAT & PHYSICS ---

function extendLoreArray() {
    const offset = loreWords.length;
    loreWords = loreWords.concat(originalLoreWords);
    for(let i = offset; i < loreWords.length; i++) {
        if (Math.random() < 0.15) hazardIndices.add(i); 
    }
}

function updateCombo(isHit) {
    const countEl = document.getElementById('combo-count');
    if (isHit) {
        currentCombo++;
        
        // NEW GOLDILOCKS SCALING: +0.5x every 4 words, max 3.0x
        damageMultiplier = 1.0 + Math.min(2.0, Math.floor(currentCombo / 4) * 0.5);
        
        countEl.innerText = `x${damageMultiplier.toFixed(1)}`;
        
        // Change color to gold earlier (at 2.0x) to reward the new scaling
        countEl.style.color = damageMultiplier >= 2.0 ? '#facc15' : '#cbd5e1';
    } else {
        currentCombo = 0;
        damageMultiplier = 1.0;
        countEl.innerText = `x1.0`;
        countEl.style.color = '#cbd5e1';
    }
}

function spawnDamagePopup(x, y, dmg, isCrit) {
    const arena = document.getElementById('boss-arena');
    const popup = document.createElement('div');
    popup.className = isCrit ? 'dmg-popup dmg-crit' : 'dmg-popup';
    popup.innerText = `-${Math.round(dmg)}`;
    
    const scatterX = (Math.random() - 0.5) * 60;
    const scatterY = (Math.random() - 0.5) * 40;
    
    popup.style.left = (x + scatterX) + 'px';
    popup.style.top = (y + scatterY) + 'px';
    
    arena.appendChild(popup);
    setTimeout(() => popup.remove(), 1000);
}

function spawnParticles(x, y) {
    const arena = document.getElementById('boss-arena');
    for (let i = 0; i < 5; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        arena.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 50 + 20;
        const destX = Math.cos(angle) * velocity;
        const destY = Math.sin(angle) * velocity;

        p.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(${destX}px, ${destY}px) scale(0)`, opacity: 0 }
        ], { duration: 400 + Math.random()*200, easing: 'ease-out' });

        setTimeout(() => p.remove(), 600);
    }
}

function shootLaser(isBossAttack, playerId, damageAmount = 0) {
    const arena = document.getElementById('boss-arena');
    const boss = document.getElementById('boss-entity');
    let avatar = document.getElementById('avatar-' + playerId);
    
    if (!boss || !avatar) return;

    const bossRect = boss.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();

    const startX = isBossAttack ? bossRect.left + bossRect.width/2 - arenaRect.left : avatarRect.left + avatarRect.width/2 - arenaRect.left;
    const startY = isBossAttack ? bossRect.top + bossRect.height/2 - arenaRect.top : avatarRect.top - arenaRect.top;

    const endX = isBossAttack ? avatarRect.left + avatarRect.width/2 - arenaRect.left : bossRect.left + bossRect.width/2 - arenaRect.left;
    const endY = isBossAttack ? avatarRect.top - arenaRect.top : bossRect.top + bossRect.height/2 - arenaRect.top;

    const laser = document.createElement('div');
    laser.className = isBossAttack ? 'laser boss-laser' : 'laser';
    if(damageMultiplier > 1.5 && !isBossAttack) laser.style.background = '#facc15'; 

    laser.style.left = startX + 'px';
    laser.style.top = startY + 'px';

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    laser.style.height = distance + 'px';
    laser.style.transformOrigin = 'top left';
    laser.style.transform = `rotate(${angle - 90}deg) scaleY(0)`; 

    arena.appendChild(laser);
    setTimeout(() => laser.style.transform = `rotate(${angle - 90}deg) scaleY(1)`, 10);

    setTimeout(() => {
        laser.remove();
        if (isBossAttack) {
            avatar.style.transform = 'translateY(10px) scale(0.9)';
            avatar.style.borderColor = '#ef4444';
            setTimeout(() => {
                avatar.style.transform = playerId === socket.id ? 'translateY(-10px) scale(1.1)' : 'scale(1)';
                avatar.style.borderColor = playerId === socket.id ? '#3b82f6' : '#cbd5e1';
            }, 200);
        } else {
            flashBoss();
            spawnParticles(endX, endY);
            if (damageAmount > 0) spawnDamagePopup(endX, endY, damageAmount, damageMultiplier > 1.5);
        }
    }, 150);
}

socket.on('raidAttackUpdate', (data) => shootLaser(false, data.id));
socket.on('raidHazardUpdate', (data) => shootLaser(true, data.id));

function triggerBossAttack(playerId, isLocal) {
    shootLaser(true, playerId);
    
    if (isLocal) {
        updateCombo(false); 
        document.getElementById('game-ui').classList.add('system-shock');
        setTimeout(() => document.getElementById('game-ui').classList.remove('system-shock'), 400);
        
        const penalty = isEnraged ? 150 : 50; 
        totalDamageDealt = Math.max(0, totalDamageDealt - penalty);
        currentWordIndex = Math.max(0, currentWordIndex - 3); 
        
        logMessage(`<span style="color:#ef4444">[HAZARD] Direct Hit! Boss healed by ${penalty} HP.</span>`);
        socket.emit('dealDamage', { roomCode: currentRoomCode, damage: -penalty });
        renderText();
    } else {
        const pName = activePlayers[playerId] ? activePlayers[playerId].name : 'Ally';
        logMessage(`<span style="color:#fca5a5">[WARN] Boss hit ${pName}!</span>`);
    }
}

// --- GAME STATE SYNC ---
socket.on('bossHit', (data) => { 
    updateHealthBar(data.newHp); 
    flashBoss(); 
});

socket.on('bossDefeated', async (data) => {
    updateHealthBar(0); 
    isPlaying = false;
    document.getElementById('input-field').disabled = true; 
    
    const boss = document.getElementById('boss-entity');
    if(boss) boss.classList.add('boss-dead');

    const timeMins = Math.max(0.1, (Date.now() - sessionStartTime) / 60000);
    const wpm = Math.round((totalDamageDealt / 2 / 5) / timeMins) || 0; 
    const acc = Math.max(0, Math.round(((sessionKeystrokes - sessionErrors) / Math.max(1, sessionKeystrokes)) * 100)) || 0;
    
    logMessage(`[VICTORY] You dealt ${Math.round(totalDamageDealt)} DMG. Securing logs...`);
    
    setTimeout(() => {
        document.getElementById('end-screen').style.display = 'flex';
        document.getElementById('final-dmg').innerText = Math.round(totalDamageDealt);
        document.getElementById('final-wpm').innerText = wpm;
    }, 1500);

    try {
        await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ gameMode: 'colosseumRaid', wpm: wpm, accuracy: acc, burstSpeed: peakRaidBurst, score: Math.round(totalDamageDealt) })
        }); 
        document.getElementById('save-status').innerText = "Logs Secured. Boss Terminated.";
        document.getElementById('save-status').style.color = "#10b981";
    } catch (err) {
        document.getElementById('save-status').innerText = "Offline: Logs lost.";
        document.getElementById('save-status').style.color = "#ef4444";
    }
    sessionStartTime = 0; sessionKeystrokes = 0; sessionErrors = 0; peakRaidBurst = 0; totalDamageDealt = 0;
});

function updateHealthBar(hp) {
    currentHp = hp; 
    const percent = Math.max(0, (currentHp / maxHp) * 100);
    const fill = document.getElementById('boss-hp-fill');
    fill.style.width = `${percent}%`; 
    document.getElementById('boss-hp-text').innerText = `${Math.round(currentHp)} / ${maxHp}`;

    if (percent <= 40 && !isEnraged && currentHp > 0) {
        isEnraged = true;
        document.getElementById('boss-entity').classList.add('boss-enraged');
        document.getElementById('dynamic-bg').classList.add('enraged-bg');
        fill.classList.add('hp-enraged');
        
        const warning = document.getElementById('enrage-warning');
        warning.style.display = 'block';
        setTimeout(() => warning.style.display = 'none', 3000);
        logMessage(`<span style="color:#d946ef; font-weight:bold;">[DANGER] Boss has entered ENRAGE phase!</span>`);
    }
}

// --- TYPING & SCROLLING ---

// FIX: Micro-delay wrapper ensures the browser DOM updates fully before checking offset.
function updateScroll() {
    setTimeout(() => {
        const currentWordEl = document.getElementById(`word-${currentWordIndex}`);
        const textContent = document.getElementById('text-content');
        if (currentWordEl && textContent) {
            if (currentWordIndex === 0) {
                textContent.style.transform = `translateY(0px)`;
                return;
            }
            const offset = currentWordEl.offsetTop;
            textContent.style.transform = `translateY(-${offset}px)`;
        }
    }, 10);
}

function renderText() {
    const typedVal = document.getElementById('input-field').value;
    
    const html = loreWords.map((w, i) => {
        const isHazard = hazardIndices.has(i);
        let classes = "word ";
        if (isHazard) classes += "hazard ";

        if (i < currentWordIndex) classes += "correct";
        else if (i === currentWordIndex) {
            const isError = typedVal.length > 0 && !w.startsWith(typedVal.trim());
            classes += "current " + (isError ? "error" : "");
        } else {
            classes += "untyped";
        }
        return `<span class="${classes}" id="word-${i}">${w}</span>`;
    }).join(" "); 
    
    document.getElementById('text-content').innerHTML = html;
    updateScroll();
}

document.getElementById('input-field').addEventListener('input', (e) => {
    if (!isPlaying || currentHp <= 0) return;
    if (sessionStartTime === 0) { sessionStartTime = Date.now(); lastWordTime = Date.now(); }
    
    sessionKeystrokes++; 
    const val = e.target.value; 
    const currentWord = loreWords[currentWordIndex];
    const isHazard = hazardIndices.has(currentWordIndex);
    
    if (!currentWord.startsWith(val.trim())) {
        sessionErrors++;
        updateCombo(false); 
        
        if (isHazard) {
            e.target.value = "";
            socket.emit('raidHazardHit', { roomCode: currentRoomCode });
            triggerBossAttack(socket.id, true);
            return;
        }
    }
    
    renderText(); 

    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            updateCombo(true); 
            
            let now = Date.now(); 
            let burstWpm = Math.round((currentWord.length / 5) / ((now - lastWordTime) / 60000));
            if (burstWpm > peakRaidBurst && burstWpm < 300) peakRaidBurst = burstWpm;
            lastWordTime = now; 
            
            const baseDamage = currentWord.length * 2; 
            const finalDamage = baseDamage * damageMultiplier;
            totalDamageDealt += finalDamage;
            
            shootLaser(false, socket.id, finalDamage);
            socket.emit('raidAttack', { roomCode: currentRoomCode });
            socket.emit('dealDamage', { roomCode: currentRoomCode, damage: finalDamage });
            
            currentWordIndex++; 
            e.target.value = ""; 
            
            // INFINITE SCROLL GENERATOR
            if (currentWordIndex >= loreWords.length - 15) {
                extendLoreArray();
            }
            
            renderText();
        }
    }
});

async function fetchLeaderboards() {
    try {
        const res = await fetch('/api/leaderboards');
        const data = await res.json();
        let html = '';
        data.forEach((user, index) => {
            const stats = user.games && user.games.colosseumRaid ? user.games.colosseumRaid : { played: 0, totalDamage: 0 };
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); background: ${index % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent'};">
                    <td style="padding: 12px; font-weight: bold; color: white;">${user.gamertag}</td>
                    <td style="padding: 12px; color: #e11d48; font-weight: 900;">${user.skillScore || 0}</td>
                    <td style="padding: 12px; color: #cbd5e1; text-align: center;">${stats.played}</td>
                    <td style="padding: 12px; color: #fb7185; text-align: center;">${Math.round(stats.totalDamage)}</td>
                </tr>
            `;
        });
        document.getElementById('leaderboard-body').innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No raiders found.</td></tr>';
    } catch(e) {
        document.getElementById('leaderboard-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444; padding: 20px;">Error loading leaderboard.</td></tr>';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboards();
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) { document.getElementById('room-code-input').value = roomFromUrl.toUpperCase(); joinExistingRoom(); }
});