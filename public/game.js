const socket = io();
let playerID, opponentID, playerName, opponentName;
let isRacing = false;

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 400,
    parent: 'ui-container',
    physics: { default: 'arcade' },
    scene: { preload: preload, create: create, update: update }
};

let wpmText;
const game = new Phaser.Game(config);
let p1Car, p2Car, track;

const targetParagraph = "In the professional software development environment typing speed and accuracy are fundamental skills that directly impact productivity However traditional typing tutors are often monotonous static and fail to retain user interest over long periods There is a critical need for an educational tool that leverages flow state psychology turning the repetitive task of typing into an engaging high stakes interactive experience to significantly improve user proficiency";
const words = targetParagraph.split(" ");
let currentWordIndex = 0;
let startTime, errors = 0, totalTyped = 0;

function preload() {
    // Using modern clean sky background
    this.load.image('track', 'https://labs.phaser.io/assets/skies/gradient26.png');
    this.load.image('car_player', 'https://labs.phaser.io/assets/sprites/car-yellow.png');
    this.load.image('car_opponent', 'https://labs.phaser.io/assets/sprites/car-red.png');
}

function create() {
    // TileSprite for the road
    track = this.add.tileSprite(0, 0, 800, 400, 'track').setOrigin(0);
    
    // FIX: Opponent car rotation. 
    // If the sprite is facing "Up" in the image, we rotate it 90 degrees to face "Right"
    p1Car = this.physics.add.sprite(50, 120, 'car_player').setScale(0.5).setAngle(90);
    p2Car = this.physics.add.sprite(50, 280, 'car_opponent').setScale(0.5).setAngle(90);

    // Floating WPM Label
    wpmText = this.add.text(p1Car.x, p1Car.y - 40, '0 WPM', { 
        font: 'bold 16px Inter', 
        fill: '#6366f1',
        backgroundColor: '#ffffff',
        padding: { x: 5, y: 2 }
    }).setOrigin(0.5);
    
    document.getElementById('ready-btn').onclick = () => {
        playerName = document.getElementById('username').value || "PLAYER";
        socket.emit('joinGame', playerName);
        document.getElementById('lobby').innerHTML = "<h2>WAITING FOR OPPONENT...</h2>";
    };
}

function update() {
    if (isRacing) track.tilePositionX += 5;
}

// Socket Logic
socket.on('matchFound', (data) => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    
    const opponent = data.players.find(p => p.id !== socket.id);
    opponentName = opponent.name;
    document.getElementById('vs-header').innerText = `${playerName} VS ${opponentName}`;
    
    startCountdown();
});

function startCountdown() {
    let count = 5;
    const overlay = document.getElementById('timer-overlay');
    const timer = setInterval(() => {
        overlay.innerText = count;
        count--;
        if (count < 0) {
            clearInterval(timer);
            overlay.style.display = 'none';
            beginRace();
        }
    }, 1000);
}

function beginRace() {
    isRacing = true;
    startTime = Date.now();
    renderText();
    
    const input = document.getElementById('input-field');
    input.focus();
    
    // NOW CALLING THE NAMED FUNCTION
    input.addEventListener('input', handleTyping);
}

function handleTyping(e) {
    const val = e.target.value;
    const currentWord = words[currentWordIndex];

    // Real-time WPM Calculation
    const timeElapsed = (Date.now() - startTime) / 60000; // in minutes
    const currentWPM = Math.round((totalTyped / 5) / timeElapsed) || 0;

    // Update Floating UI
    wpmText.setText(`${currentWPM} WPM`);
    wpmText.setPosition(p1Car.x, p1Car.y - 50);

    if (val.endsWith(" ")) {
        if (val.trim() === currentWord) {
            totalTyped += currentWord.length + 1;
            currentWordIndex++;
            e.target.value = "";
            
            const progress = currentWordIndex / words.length;
            
            // Move car forward based on progress
            p1Car.x = 50 + (progress * 700);
            
            // Sync with server
            socket.emit('updateProgress', { 
                progress: progress,
                wpm: currentWPM 
            });
            
            if (currentWordIndex === words.length) finishRace(true);
            renderText();
        } else {
            errors++;
        }
    }
}

socket.on('opponentProgress', (data) => {
    p2Car.x = 50 + (data.progress * 700);
    if (data.progress >= 1) finishRace(false);
});

function renderText() {
    // Shows the ENTIRE paragraph, highlighting only the active word
    const html = words.map((w, i) => {
        if (i < currentWordIndex) return `<span style="color: #cbd5e1;">${w}</span>`; // Already typed
        if (i === currentWordIndex) return `<span class="current">${w}</span>`; // Current word
        return `<span>${w}</span>`; // Future words
    }).join(" ");
    
    document.getElementById('target-text').innerHTML = html;
}

function finishRace(isWinner) {
    if (!isRacing) return;
    isRacing = false;
    const time = (Date.now() - startTime) / 60000;
    const wpm = Math.round((totalTyped / 5) / time);
    const acc = Math.max(0, Math.round(((totalTyped - errors) / totalTyped) * 100));

    document.getElementById('game-ui').style.display = 'none';
    const end = document.getElementById('end-screen');
    end.style.display = 'flex';
    document.getElementById('result-banner').innerText = isWinner ? "🏆 Victory!" : "🏳️ Defeat";
    document.getElementById('stats').innerText = `SPEED: ${wpm} WPM | ACCURACY: ${acc}%`;
}