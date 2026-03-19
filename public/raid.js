const socket = io();
let playerName = localStorage.getItem('gamertag') || "RAIDER";
let currentRoomCode = null, maxHp = 5000, currentHp = 5000, loreWords = [], currentWordIndex = 0, totalDamageDealt = 0; 
let sessionStartTime = 0, sessionKeystrokes = 0, sessionErrors = 0, lastWordTime = 0, peakRaidBurst = 0;

const config = { type: Phaser.AUTO, width: 900, height: 300, parent: 'phaser-mount', transparent: true, scene: { preload: preload, create: create } };
const game = new Phaser.Game(config);
let bossSprite, sceneRef;

function preload() { this.load.image('boss', 'https://labs.phaser.io/assets/sprites/space-baddie.png'); }
function create() {
    sceneRef = this; bossSprite = this.add.sprite(450, 150, 'boss').setScale(8);
    this.tweens.add({ targets: bossSprite, y: 130, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
}
function flashBoss() { if (!bossSprite) return; bossSprite.setTint(0xff0000); setTimeout(() => bossSprite.clearTint(), 100); sceneRef.cameras.main.shake(100, 0.01); }

function hostRoom() { socket.emit('createRoom', { name: playerName, gameMode: 'colosseumRaid' }); }
function joinExistingRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length < 5) return; currentRoomCode = code;
    socket.emit('joinRoom', { name: playerName, roomCode: code });
}
function surrenderMatch() {
    if (confirm("Are you sure you want to abandon the Raid?")) {
        socket.emit('leaveRoom', { roomCode: currentRoomCode, name: playerName });
        localStorage.removeItem('activeRoomUrl');
        window.location.href = 'hub.html';
    }
}

socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    window.history.pushState({ room: currentRoomCode }, '', `?room=${currentRoomCode}`);
    localStorage.setItem('activeRoomUrl', window.location.href);
    setupGameScreen(data);
});

socket.on('raidState', (data) => { localStorage.setItem('activeRoomUrl', window.location.href); setupGameScreen(data); });
socket.on('rejoinRaidSuccess', (data) => { localStorage.setItem('activeRoomUrl', window.location.href); setupGameScreen(data); });
socket.on('roomError', (msg) => {
    const errObj = document.getElementById('room-error'); errObj.innerText = msg; errObj.style.display = 'block';
    if (msg.includes('not found') || msg.includes('expired')) localStorage.removeItem('activeRoomUrl');
});

function setupGameScreen(data) {
    document.getElementById('lobby').style.display = 'none'; document.getElementById('game-ui').style.display = 'block'; document.getElementById('exit-btn').style.display = 'block';
    
    document.getElementById('display-room-code').value = currentRoomCode;
    document.getElementById('display-room-link').value = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;

    maxHp = data.boss.maxHp; updateHealthBar(data.boss.hp);
    loreWords = data.boss.activeLore.split(" "); currentWordIndex = 0; renderText(); logMessage("Connected to Raid Room: " + currentRoomCode);
    
    const input = document.getElementById('input-field'); input.disabled = false; input.focus();
}

socket.on('playerJoinedRaid', (data) => { logMessage(`${data.name} has joined the battle!`); });
socket.on('playerLeftRaid', (data) => { logMessage(`${data.name} abandoned the raid.`); });
socket.on('opponentDisconnected', (data) => { logMessage(`${data.name} disconnected (60s to rejoin).`); });
socket.on('opponentReconnected', (data) => { logMessage(`${data.name} reconnected!`); });

socket.on('bossHit', (data) => { updateHealthBar(data.newHp); flashBoss(); });
socket.on('bossDefeated', async (data) => {
    updateHealthBar(0); document.getElementById('input-field').disabled = true; if(bossSprite) bossSprite.setTint(0x555555);
    const timeMins = Math.max(0.1, (Date.now() - sessionStartTime) / 60000);
    const wpm = Math.round((totalDamageDealt / 2 / 5) / timeMins) || 0; 
    const acc = Math.max(0, Math.round(((sessionKeystrokes - sessionErrors) / Math.max(1, sessionKeystrokes)) * 100)) || 0;
    logMessage(`VICTORY! ${data.message} You dealt ${totalDamageDealt} damage. Saving stats...`);
    try {
        await fetch('/api/game/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ gameMode: 'colosseumRaid', wpm: wpm, accuracy: acc, burstSpeed: peakRaidBurst, score: totalDamageDealt })
        }); logMessage(`Stats Synced! WPM: ${wpm} | ACC: ${acc}%`);
    } catch (err) {}
    sessionStartTime = 0; sessionKeystrokes = 0; sessionErrors = 0; peakRaidBurst = 0; totalDamageDealt = 0;
});

socket.on('bossRespawned', (boss) => {
    maxHp = boss.maxHp; updateHealthBar(boss.hp);
    document.getElementById('input-field').disabled = false; document.getElementById('input-field').value = ''; currentWordIndex = 0;
    renderText(); logMessage("A new Behemoth has appeared!"); if(bossSprite) bossSprite.clearTint();
});

function updateHealthBar(hp) {
    currentHp = hp; const percent = Math.max(0, (currentHp / maxHp) * 100);
    document.getElementById('boss-hp-fill').style.width = `${percent}%`; document.getElementById('boss-hp-text').innerText = `${currentHp} / ${maxHp}`;
}
function logMessage(msg) { const log = document.getElementById('raid-log'); log.innerHTML = `<div>> ${msg}</div>` + log.innerHTML; }
function renderText() {
    const html = loreWords.map((w, i) => {
        if (i < currentWordIndex) return `<span class="typed">${w}</span>`; 
        if (i === currentWordIndex) return `<span class="current">${w}</span>`; 
        return `<span>${w}</span>`; 
    }).join(" "); document.getElementById('target-text').innerHTML = html;
}

document.getElementById('input-field').addEventListener('input', (e) => {
    if (currentHp <= 0) return;
    if (sessionStartTime === 0) { sessionStartTime = Date.now(); lastWordTime = Date.now(); }
    sessionKeystrokes++; const val = e.target.value; const currentWord = loreWords[currentWordIndex];
    if (!currentWord.startsWith(val.trim())) sessionErrors++;
    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            let now = Date.now(); let burstWpm = Math.round((currentWord.length / 5) / ((now - lastWordTime) / 60000));
            if (burstWpm > peakRaidBurst && burstWpm < 300) peakRaidBurst = burstWpm;
            lastWordTime = now; const damage = currentWord.length * 2; totalDamageDealt += damage;
            socket.emit('dealDamage', { roomCode: currentRoomCode, name: playerName, damage: damage });
            currentWordIndex++; e.target.value = ""; if (currentWordIndex >= loreWords.length) currentWordIndex = 0; renderText();
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
            const played = stats.played;
            const dmg = stats.totalDamage;
            
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); background: ${index % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'transparent'};">
                    <td style="padding: 12px; font-weight: bold; color: white;">${user.gamertag}</td>
                    <td style="padding: 12px; color: #e11d48; font-weight: 900;">${user.skillScore || 0}</td>
                    <td style="padding: 12px; color: #cbd5e1; text-align: center;">${played}</td>
                    <td style="padding: 12px; color: #fb7185; text-align: center;">${dmg}</td>
                </tr>
            `;
        });
        document.getElementById('leaderboard-body').innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px;">No raiders found.</td></tr>';
    } catch(e) {
        console.error("Leaderboard error:", e);
        document.getElementById('leaderboard-body').innerHTML = '<tr><td colspan="4" style="text-align:center; color:#ef4444; padding: 20px;">Error loading leaderboard.</td></tr>';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboards();
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) { document.getElementById('room-code-input').value = roomFromUrl.toUpperCase(); joinExistingRoom(); }
});