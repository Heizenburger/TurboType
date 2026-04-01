const socket = io();

// --- GAME STATE ---
let sessionStats = { totalKeystrokes: 0, correctKeystrokes: 0, startTime: 0, peakBurstWPM: 0, lastWordTime: 0 };
let PLAYER_MAX_HEALTH = 100, currentHealth = 100;
let ENEMY_DAMAGE = 20; 
let score = 0, currentWave = 1, enemiesDefeatedInWave = 0;
let isGameOver = false;

// --- ENGINE VARIABLES ---
let game, sceneRef;
let player, background;
let enemiesGroup, projectilesGroup;
const LANES = [400, 500, 600]; // 3 Zombie horde lanes
const MAX_ENEMIES_ON_SCREEN = 5;

// --- TARGETING SYSTEM ---
let activeTarget = null;
let currentWaveWords = [];
let spawnEvent;

// 1. Fetch Player Data & Init (BULLETPROOFED)
// 1. Fetch Player Data & Init (WITH AUTO-REDIRECT FIX)
async function initializeGame() {
    try {
        const res = await fetch('/api/account', { 
            method: 'GET',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } 
        });
        
        if (res.ok) {
            const user = await res.json();
            applyDifficultyScaling(user.skillScore || 0);
            
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('game-ui').style.display = 'block';
            
            // Start Phaser
            game = new Phaser.Game(config);
        } else {
            console.error("Account fetch failed with status:", res.status);
            
            // If the token is dead or unauthorized, instantly kick them to login
            if (res.status === 401 || res.status === 403) {
                localStorage.clear();
                window.location.href = 'index.html';
            } else {
                document.getElementById('loading-screen').innerText = "Server Error. Please reconnect.";
                document.getElementById('loading-screen').style.color = "#ef4444";
            }
        }
    } catch (err) { 
        console.error("Failed to fetch user data", err); 
        document.getElementById('loading-screen').innerText = "Network Error. Please check connection.";
        document.getElementById('loading-screen').style.color = "#ef4444";
    }
}

function applyDifficultyScaling(skill) {
    if (skill > 800) ENEMY_DAMAGE = 34; // 3 hits
    else if (skill > 400) ENEMY_DAMAGE = 25; // 4 hits
    else ENEMY_DAMAGE = 20; // 5 hits
}

// 2. Wave Management (Socket to Server)
function requestNextWave() {
    socket.emit('requestSamuraiWave', { wave: currentWave });
}

socket.on('samuraiWaveData', (data) => {
    currentWaveWords = data.words;
    enemiesDefeatedInWave = 0;
    
    // Announce Wave
    const announce = document.getElementById('wave-announcement');
    announce.innerText = `WAVE ${currentWave}`;
    announce.classList.add('show');
    setTimeout(() => announce.classList.remove('show'), 2000);
    document.getElementById('ui-wave').innerText = currentWave;

    // Start Spawning
    const spawnDelay = Math.max(1000, 3500 - (currentWave * 300)); // Gets faster every wave
    if (spawnEvent) spawnEvent.remove();
    spawnEvent = sceneRef.time.addEvent({ delay: spawnDelay, callback: trySpawnEnemy, callbackScope: sceneRef, loop: true });
});

// 3. Phaser Configuration
const config = {
    type: Phaser.AUTO, 
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1280, height: 720 },
    physics: { default: 'arcade' },
    scene: { preload: preload, create: create, update: update }
};

function preload () {
    this.load.image('city', 'assets/bg.png'); 
    this.load.spritesheet('hero_idle', 'assets/player_idle.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('hero_run', 'assets/player_run.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('hero_attack', 'assets/player_attack.png', { frameWidth: 96, frameHeight: 96 });
}

function create () {
    sceneRef = this;
    background = this.add.tileSprite(640, 360, 1280, 720, 'city');
    background.setAlpha(0.6); // Darken BG slightly for visibility

    this.anims.create({ key: 'idle', frames: this.anims.generateFrameNumbers('hero_idle', { start: 0, end: 9 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'run', frames: this.anims.generateFrameNumbers('hero_run', { start: 0, end: 7 }), frameRate: 12, repeat: -1 });
    this.anims.create({ key: 'attack', frames: this.anims.generateFrameNumbers('hero_attack', { start: 0, end: 5 }), frameRate: 20, repeat: 0 });

    player = this.physics.add.sprite(200, 500, 'hero_idle').setScale(2.5).play('idle');
    player.body.setSize(30, 80); 
    player.setDepth(500); // Lock player depth

    enemiesGroup = this.physics.add.group();
    projectilesGroup = this.physics.add.group();

    // Generate Energy Projectile Texture dynamically
    let graphics = this.add.graphics();
    graphics.fillStyle(0x60a5fa, 1);
    graphics.fillCircle(10, 10, 10);
    graphics.generateTexture('energy_blast', 20, 20);
    graphics.destroy();

    this.physics.add.overlap(player, enemiesGroup, takeDamage, null, this);
    this.physics.add.overlap(projectilesGroup, enemiesGroup, handleProjectileImpact, null, this);
    
    player.on('animationcomplete', anim => { if (anim.key === 'attack') player.play('idle'); }, this);

    // Setup Typing Input
    const input = document.getElementById('target-input');
    input.focus();
    document.addEventListener('click', () => input.focus());
    this.input.keyboard.on('keydown', handleTyping);

    // Start First Wave
    requestNextWave();
}

function update () {
    if (isGameOver) return;

    // Depth Sorting & Word Positioning
    enemiesGroup.children.iterate(enemy => {
        if (enemy && enemy.active) {
            enemy.setDepth(enemy.y); // Creates 3D perspective
            
            // Lock Text above enemy
            if (enemy.wordTextGroup) {
                enemy.wordTextGroup.setPosition(enemy.x, enemy.y - 100);
                enemy.wordTextGroup.setDepth(enemy.y + 1);
            }

            // Animate based on distance
            let dist = Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y);
            if (dist < 150 && enemy.anims.currentAnim.key !== 'attack') enemy.play('attack');
            else if (dist >= 150 && enemy.anims.currentAnim.key !== 'run') enemy.play('run');
        }
    });
}

function trySpawnEnemy() {
    if (isGameOver || enemiesGroup.countActive(true) >= MAX_ENEMIES_ON_SCREEN || currentWaveWords.length === 0) return;

    // Pop a word from the wave array
    const spawnWord = currentWaveWords.pop();
    const laneY = LANES[Phaser.Math.Between(0, 2)];

    let enemy = enemiesGroup.create(1350, laneY, 'hero_run').setScale(2.5).setFlipX(true).setTint(0xff5555).play('run'); 
    
    let speedBase = 50 + (currentWave * 15);
    enemy.setVelocityX(-Phaser.Math.Between(speedBase, speedBase + 40));
    
    // Setup Target Lock Text
    enemy.targetWord = spawnWord;
    enemy.typedIndex = 0;
    
    // We use a container to hold the typed (Green) and untyped (White) text
    enemy.wordTextGroup = sceneRef.add.container(enemy.x, enemy.y - 100);
    enemy.typedText = sceneRef.add.text(0, 0, "", { fontSize: '28px', fontStyle: 'bold', fill: '#34d399', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0.5);
    enemy.untypedText = sceneRef.add.text(0, 0, spawnWord, { fontSize: '28px', fontStyle: 'bold', fill: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0.5);
    
    enemy.wordTextGroup.add([enemy.typedText, enemy.untypedText]);
}

// --- TARGET LOCK & COMBAT LOGIC ---
function handleTyping(event) {
    if (isGameOver) return;
    
    let char = event.key.toUpperCase();
    if (!/^[A-Z\-]$/.test(char)) return; // Ignore non-letters

    if (sessionStats.startTime === 0) sessionStats.startTime = Date.now();
    sessionStats.totalKeystrokes++;

    // NO TARGET LOCKED: Search for an enemy starting with this letter
    if (!activeTarget) {
        let potentialTarget = null;
        enemiesGroup.children.iterate(enemy => {
            if (enemy && enemy.active && enemy.targetWord[0] === char && !potentialTarget) {
                potentialTarget = enemy;
            }
        });

        if (potentialTarget) {
            activeTarget = potentialTarget;
            activeTarget.typedIndex = 1;
            sessionStats.correctKeystrokes++;
            updateEnemyText(activeTarget);
            
            // Auto-complete 1-letter words immediately
            if (activeTarget.typedIndex === activeTarget.targetWord.length) {
                executeAttack(activeTarget);
                activeTarget = null;
            }
        }

    // TARGET LOCKED: Check subsequent letters
    } else {
        let expectedChar = activeTarget.targetWord[activeTarget.typedIndex];
        
        if (char === expectedChar) {
            activeTarget.typedIndex++;
            sessionStats.correctKeystrokes++;
            updateEnemyText(activeTarget);

            if (activeTarget.typedIndex === activeTarget.targetWord.length) {
                executeAttack(activeTarget);
                activeTarget = null;
            }
        } else {
            // Typo: Flash the enemy text red
            activeTarget.untypedText.setTint(0xff0000);
            setTimeout(() => { if (activeTarget && activeTarget.untypedText) activeTarget.untypedText.clearTint(); }, 200);
        }
    }
}

function updateEnemyText(enemy) {
    let typed = enemy.targetWord.substring(0, enemy.typedIndex);
    let untyped = enemy.targetWord.substring(enemy.typedIndex);
    
    enemy.typedText.setText(typed);
    enemy.untypedText.setText(untyped);
    
    // Highlight active target
    enemy.untypedText.setColor('#facc15'); // Yellow for target lock
}

function executeAttack(target) {
    let dist = Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y);
    
    // Calculate Burst
    let now = Date.now();
    let timeTakenMins = (now - sessionStats.lastWordTime) / 60000;
    if(sessionStats.lastWordTime > 0) {
        let burst = Math.round((target.targetWord.length / 5) / timeTakenMins);
        if (burst > sessionStats.peakBurstWPM && burst < 300) sessionStats.peakBurstWPM = burst;
    }
    sessionStats.lastWordTime = now;

    player.play('attack');
    
    if (dist < 200) {
        // MELEE COMBAT
        killEnemy(target);
    } else {
        // RANGED COMBAT (Energy Blast)
        let proj = projectilesGroup.create(player.x + 40, player.y - 20, 'energy_blast');
        proj.setDepth(target.depth + 1);
        sceneRef.physics.moveToObject(proj, target, 1200); // Super fast projectile
        proj.targetEnemy = target;
    }
}

function handleProjectileImpact(proj, enemy) {
    if (proj.targetEnemy === enemy) {
        killEnemy(enemy);
        proj.destroy();
    }
}

function killEnemy(enemy) {
    if(!enemy.active) return;
    
    // Visual FX
    let flash = sceneRef.add.graphics();
    flash.fillStyle(0xffffff, 1);
    flash.fillCircle(enemy.x, enemy.y - 50, 40);
    sceneRef.tweens.add({ targets: flash, alpha: 0, scale: 2, duration: 300, onComplete: () => flash.destroy() });

    enemy.wordTextGroup.destroy();
    enemy.destroy();
    
    score += (currentWave * 10);
    document.getElementById('ui-score').innerText = score;
    
    enemiesDefeatedInWave++;
    
    // Check Wave Progression
    if (currentWaveWords.length === 0 && enemiesGroup.countActive(true) === 0) {
        currentWave++;
        requestNextWave();
    }
}

async function takeDamage(playerObj, enemy) {
    if (!enemy.active) return;
    
    // Clear lock if we get hit by our target
    if (activeTarget === enemy) activeTarget = null;
    
    enemy.wordTextGroup.destroy();
    enemy.destroy();
    
    currentHealth -= ENEMY_DAMAGE;
    const hpFill = document.getElementById('ui-hp-fill');
    hpFill.style.width = Math.max(0, (currentHealth / PLAYER_MAX_HEALTH) * 100) + '%';
    if (currentHealth <= 30) hpFill.classList.add('danger');

    sceneRef.cameras.main.shake(200, 0.02);
    player.setTint(0xff0000);
    setTimeout(() => player.clearTint(), 200);

    if (currentHealth <= 0 && !isGameOver) {
        isGameOver = true;
        sceneRef.physics.pause();
        player.setTint(0x555555);
        player.anims.stop(); 
        
        let totalMins = (Date.now() - sessionStats.startTime) / 60000;
        let finalWpm = Math.round((sessionStats.correctKeystrokes / 5) / totalMins) || 0;
        let finalAcc = Math.round((sessionStats.correctKeystrokes / Math.max(1, sessionStats.totalKeystrokes)) * 100) || 0;
        
        document.getElementById('game-ui').style.display = 'none';
        document.getElementById('end-screen').style.display = 'flex';
        document.getElementById('final-wave').innerText = currentWave - 1;
        document.getElementById('final-score').innerText = score;
        document.getElementById('final-wpm').innerText = finalWpm;

        try {
            await fetch('/api/game/end', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ gameMode: 'samuraiTyping', wpm: finalWpm, accuracy: finalAcc, burstSpeed: sessionStats.peakBurstWPM, score: currentWave - 1 })
            });
            document.getElementById('save-status').innerText = "Combat Logs Secured.";
            document.getElementById('save-status').style.color = "#10b981";
        } catch (err) {
            document.getElementById('save-status').innerText = "Offline: Logs lost.";
            document.getElementById('save-status').style.color = "#ef4444";
        }
    }
}

// Start sequence
initializeGame();