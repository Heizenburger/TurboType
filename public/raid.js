const socket = io();
let playerName = localStorage.getItem('gamertag') || "RAIDER";
let currentRoomCode = null, maxHp = 5000, currentHp = 5000, loreWords = [], currentWordIndex = 0, totalDamageDealt = 0; 
let sessionStartTime = 0, sessionKeystrokes = 0, sessionErrors = 0, lastWordTime = 0, peakRaidBurst = 0;

let hazardIndices = new Set();
let activePlayers = {}; // Track everyone in the room

function flashBoss() { 
    const boss = document.getElementById('boss-entity');
    if (!boss) return;
    boss.classList.add('hit-flash'); 
    setTimeout(() => boss.classList.remove('hit-flash'), 100); 
}

function hostRoom() { socket.emit('createRoom', { name: playerName, gameMode: 'colosseumRaid' }); }
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
    localStorage.setItem('activeRoomUrl', window.location.href);
    setupGameScreen(data);
});

socket.on('raidState', (data) => { localStorage.setItem('activeRoomUrl', window.location.href); setupGameScreen(data); });
socket.on('roomError', (msg) => {
    const errObj = document.getElementById('room-error'); errObj.innerText = msg; errObj.style.display = 'block';
    if (msg.includes('not found') || msg.includes('expired')) localStorage.removeItem('activeRoomUrl');
});

// Synced Player Avatars (Up to 5)
function renderPlayers() {
    const container = document.getElementById('players-container');
    if (!container) return;
    container.innerHTML = '';
    
    // Convert object to array and limit to 5
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

function setupGameScreen(data) {
    document.getElementById('ui-container').style.display = 'none'; 
    document.getElementById('game-ui').style.display = 'flex'; 
    document.getElementById('room-code-display').innerText = `ROOM: ${currentRoomCode}`;

    maxHp = data.boss.maxHp; updateHealthBar(data.boss.hp);
    
    const rawLore = data.boss.activeLore || "The ancient monolithic core pulsates with dark energy. Type to destroy it!";
    loreWords = rawLore.split(" "); 
    currentWordIndex = 0; 
    
    // Generate Hazard Words (15% chance)
    hazardIndices.clear();
    for(let i=0; i<loreWords.length; i++) {
        if (i > 0 && Math.random() < 0.15) hazardIndices.add(i); 
    }

    // Populate existing players from server
    activePlayers = data.players || {};
    activePlayers[socket.id] = { id: socket.id, name: playerName }; // Ensure self is in list
    renderPlayers();
    renderText(); 

    logMessage(`[SYS] Connected to Raid: [${currentRoomCode}]`);
    
    const input = document.getElementById('input-field'); 
    input.disabled = false; input.value = ""; input.focus();
}

socket.on('playerJoinedRaid', (data) => { 
    activePlayers[data.id] = { id: data.id, name: data.name };
    renderPlayers();
    logMessage(`[SYS] ${data.name} breached the arena!`); 
});

socket.on('opponentDisconnected', (data) => { 
    if(activePlayers[data.id]) {
        delete activePlayers[data.id];
        renderPlayers();
    }
    logMessage(`[WARN] ${data.name} lost connection.`); 
});

socket.on('bossHit', (data) => { updateHealthBar(data.newHp); flashBoss(); });

socket.on('bossDefeated', async (data) => {
    updateHealthBar(0); 
    document.getElementById('input-field').disabled = true; 
    
    const boss = document.getElementById('boss-entity');
    if(boss) boss.classList.add('boss-dead');

    const timeMins = Math.max(0.1, (Date.now() - sessionStartTime) / 60000);
    const wpm = Math.round((totalDamageDealt / 2 / 5) / timeMins) || 0; 
    const acc = Math.max(0, Math.round(((sessionKeystrokes - sessionErrors) / Math.max(1, sessionKeystrokes)) * 100)) || 0;
    
    logMessage(`[VICTORY] You dealt ${totalDamageDealt} DMG. Securing logs...`);
    
    document.getElementById('end-screen').style.display = 'flex';
    document.getElementById('final-dmg').innerText = totalDamageDealt;
    document.getElementById('final-wpm').innerText = wpm;

    try {
        await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ gameMode: 'colosseumRaid', wpm: wpm, accuracy: acc, burstSpeed: peakRaidBurst, score: totalDamageDealt })
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
    currentHp = hp; const percent = Math.max(0, (currentHp / maxHp) * 100);
    document.getElementById('boss-hp-fill').style.width = `${percent}%`; 
    document.getElementById('boss-hp-text').innerText = `${currentHp} / ${maxHp}`;
}

function logMessage(msg) { 
    const log = document.getElementById('log-content'); 
    log.innerHTML = `<div style="margin-bottom: 5px;">> ${msg}</div>` + log.innerHTML; 
}

// Live Multi-User Laser Combat
function shootLaser(isBossAttack, playerId) {
    const arena = document.getElementById('boss-arena');
    const boss = document.getElementById('boss-entity');
    let avatar = document.getElementById('avatar-' + playerId);
    
    // If player avatar isn't rendered (e.g., > 5 players), skip laser
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
    laser.style.left = startX + 'px';
    laser.style.top = startY + 'px';

    // Calculate angle for realistic diagonal shooting
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    laser.style.height = distance + 'px';
    laser.style.transformOrigin = 'top left';
    laser.style.transform = `rotate(${angle - 90}deg) scaleY(0)`; // Start invisible

    arena.appendChild(laser);

    // Blast effect
    setTimeout(() => {
        laser.style.transform = `rotate(${angle - 90}deg) scaleY(1)`;
    }, 10);

    // Impact
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
        }
    }, 160);
}

// Receive attacks from teammates
socket.on('raidAttackUpdate', (data) => shootLaser(false, data.id));
socket.on('raidHazardUpdate', (data) => shootLaser(true, data.id));

// Render Text & Hazard Highlights
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
        return `<span class="${classes}">${w}</span>`;
    }).join(" "); 
    document.getElementById('target-text').innerHTML = html;
}

// Boss Attack Execution
function triggerBossAttack(playerId, isLocal) {
    shootLaser(true, playerId);
    
    if (isLocal) {
        document.getElementById('game-ui').classList.add('system-shock');
        setTimeout(() => document.getElementById('game-ui').classList.remove('system-shock'), 400);
        
        const penalty = 50;
        totalDamageDealt = Math.max(0, totalDamageDealt - penalty);
        currentWordIndex = Math.max(0, currentWordIndex - 3); // Knockback
        
        logMessage(`<span style="color:#ef4444">[HAZARD] Direct Hit! Boss healed by ${penalty} HP.</span>`);
        
        // Healing boss
        socket.emit('dealDamage', { roomCode: currentRoomCode, damage: -penalty });
        renderText();
    } else {
        const pName = activePlayers[playerId] ? activePlayers[playerId].name : 'Ally';
        logMessage(`<span style="color:#fca5a5">[WARN] Boss hit ${pName}!</span>`);
    }
}

document.getElementById('input-field').addEventListener('input', (e) => {
    if (currentHp <= 0) return;
    if (sessionStartTime === 0) { sessionStartTime = Date.now(); lastWordTime = Date.now(); }
    
    sessionKeystrokes++; 
    const val = e.target.value; 
    const currentWord = loreWords[currentWordIndex];
    const isHazard = hazardIndices.has(currentWordIndex);
    
    if (!currentWord.startsWith(val.trim())) {
        sessionErrors++;
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
            let now = Date.now(); let burstWpm = Math.round((currentWord.length / 5) / ((now - lastWordTime) / 60000));
            if (burstWpm > peakRaidBurst && burstWpm < 300) peakRaidBurst = burstWpm;
            lastWordTime = now; 
            
            const damage = currentWord.length * 2; 
            totalDamageDealt += damage;
            
            shootLaser(false, socket.id);
            socket.emit('raidAttack', { roomCode: currentRoomCode });
            socket.emit('dealDamage', { roomCode: currentRoomCode, damage: damage });
            
            currentWordIndex++; 
            e.target.value = ""; 
            if (currentWordIndex >= loreWords.length) currentWordIndex = 0; 
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
                    <td style="padding: 12px; color: #fb7185; text-align: center;">${stats.totalDamage}</td>
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