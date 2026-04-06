const socket = io();

// --- GAME STATE ---
let sessionStats = { totalKeystrokes: 0, correctKeystrokes: 0, startTime: 0, peakBurstWPM: 0, lastWordTime: 0 };
let PLAYER_MAX_HEALTH = 100, currentHealth = 100;
let ENEMY_DAMAGE = 20; 
let score = 0, currentWave = 1, enemiesDefeatedInWave = 0;
let isGameOver = false;

// --- ENGINE VARIABLES ---
let game, sceneRef;
let player, ground;
let enemiesGroup, projectilesGroup;

// --- UNIFIED PARALLAX CONFIGURATION ---
const PARALLAX_CONFIG = [
    { key: 'sky', file: 'Sky.png', speed: 0.00, y: 360, originY: 0.5, scale: 1 },
    { key: 'clouds', file: 'Clouds.png', speed: 0.02, y: 300, originY: 0.5, scale: 2 },
    { key: 'fuji', file: 'Fuji.png', speed: 0.05, y: 530, originY: 1, scale: 1.5 },
    { key: 'mtn_back', file: 'Mountain_Back.png', speed: 0.08, y: 550, originY: 1, scale: 1.5 },
    // FIX: Corrected spelling to Mountain_Middle.png to remove the green/black grid
    { key: 'mtn_mid', file: 'Mountain_Middle.png', speed: 0.12, y: 560, originY: 1, scale: 1.5 }, 
    { key: 'mtn_front', file: 'Mountain_Front.png', speed: 0.18, y: 570, originY: 1, scale: 1.5 },
    { key: 'trees_far', file: 'Trees.png', speed: 0.20, y: 580, originY: 1, scale: 2 },
    { key: 'ground', file: 'Ground.png', speed: 1.00, y: 700, originY: 1, scale: 4 }, 
    { key: 'grass', file: 'Gras.png', speed: 1.20, y: 700, originY: 1, scale: 3 }
];

// --- DYNAMIC PROP CONFIGURATION ---
const PROP_KEYS = ['shrine_mult', 'shrine_single', 'house'];

// --- COMBAT ZONES ---
const LANES = [510, 560, 600]; 
const MELEE_RANGE = 250; 
const MAX_ENEMIES_ON_SCREEN = 5;

// --- TARGETING SYSTEM ---
let activeTarget = null;
let currentWaveWords = [];
let spawnEvent;

// 1. Fetch Player Data & Init
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
            
            game = new Phaser.Game(config);
        } else {
            console.error("Account fetch failed with status:", res.status);
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
    if (skill > 800) ENEMY_DAMAGE = 34; 
    else if (skill > 400) ENEMY_DAMAGE = 25; 
    else ENEMY_DAMAGE = 20; 
}

function requestNextWave() {
    socket.emit('requestSamuraiWave', { wave: currentWave });
}

socket.on('samuraiWaveData', (data) => {
    currentWaveWords = data.words;
    enemiesDefeatedInWave = 0;
    
    const announce = document.getElementById('wave-announcement');
    announce.innerText = `WAVE ${currentWave}`;
    announce.classList.add('show');
    setTimeout(() => announce.classList.remove('show'), 2000);
    document.getElementById('ui-wave').innerText = currentWave;

    const spawnDelay = Math.max(1000, 3500 - (currentWave * 300)); 
    if (spawnEvent) spawnEvent.remove();
    spawnEvent = sceneRef.time.addEvent({ delay: spawnDelay, callback: trySpawnEnemy, callbackScope: sceneRef, loop: true });
});

const config = {
    type: Phaser.AUTO, 
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1280, height: 720 },
    physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
    scene: { preload: preload, create: create, update: update }
};

function preload () {
    // Continuous Backgrounds
    PARALLAX_CONFIG.forEach(layer => {
        this.load.image(layer.key, 'assets/' + layer.file);
    });

    // Load Props Individually
    this.load.image('shrine_mult', 'assets/Shrine_Multiple.png');
    this.load.image('shrine_single', 'assets/Shrine_Single.png');
    this.load.image('house', 'assets/House.png');

    this.load.image('kunai', 'assets/kunai.png');

    this.load.spritesheet('hero_idle', 'assets/player_idle.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('hero_run', 'assets/player_run.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('hero_attack', 'assets/player_attack.png', { frameWidth: 96, frameHeight: 96 });
}

function create () {
    sceneRef = this;

    this.add.graphics().fillStyle(0x020617, 1).fillRect(0, 0, 1280, 720).setDepth(-110);

    this.parallaxSprites = [];
    
    PARALLAX_CONFIG.forEach((layer, index) => {
        let depth = -100 + index; 
        
        let tex = this.textures.get(layer.key).get();
        let nativeHeight = tex.height;
        let calcWidth = 1280 / (layer.scale || 1) + 20; 
        let h = (layer.key === 'sky' || layer.key === 'clouds') ? 720 : nativeHeight;
        
        let sprite = this.add.tileSprite(640, layer.y, calcWidth, h, layer.key);
        
        sprite.setDepth(depth);
        sprite.setOrigin(0.5, layer.originY !== undefined ? layer.originY : 1); 
        if (layer.scale) sprite.setScale(layer.scale);
        
        sprite.parallaxSpeed = layer.speed;
        this.parallaxSprites.push(sprite);
    });

    this.buildings = [];
    for (let i = 0; i < 3; i++) {
        let key = Phaser.Utils.Array.GetRandom(PROP_KEYS);
        let startX = 800 + (i * 900) + Phaser.Math.Between(0, 500);
        
        let prop = this.add.image(startX, 537, key);
        
        prop.setOrigin(0.5, 1); 
        prop.setScale(1.2);
        prop.setDepth(-80); 
        prop.parallaxSpeed = 0.45; 
        
        this.buildings.push(prop);
    }

    this.add.graphics().fillStyle(0x000000, 0.15).fillRect(0, 0, 1280, 720).setDepth(-50);

    this.anims.create({ key: 'idle', frames: this.anims.generateFrameNumbers('hero_idle', { start: 0, end: 9 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'run', frames: this.anims.generateFrameNumbers('hero_run', { start: 0, end: 7 }), frameRate: 12, repeat: -1 });
    this.anims.create({ key: 'attack', frames: this.anims.generateFrameNumbers('hero_attack', { start: 0, end: 5 }), frameRate: 20, repeat: 0 });

    // FIX: Spawns using the 'hero_run' sprite and instantly plays the 'run' animation
    player = this.physics.add.sprite(MELEE_RANGE - 50, LANES[1], 'hero_run').setScale(2.5).play('run');
    player.body.setSize(30, 80); 
    player.setDepth(LANES[1]);

    enemiesGroup = this.physics.add.group();
    projectilesGroup = this.physics.add.group();

    this.physics.add.overlap(player, enemiesGroup, takeDamage, null, this);
    this.physics.add.overlap(projectilesGroup, enemiesGroup, handleProjectileImpact, null, this);
    
    // FIX: Return to running after an attack
    player.on('animationcomplete', anim => { if (anim.key === 'attack') player.play('run'); }, this);

    const input = document.getElementById('target-input');
    input.focus();
    document.addEventListener('click', () => input.focus());
    this.input.keyboard.on('keydown', handleTyping);

    requestNextWave();
}

function update (time, delta) {
    if (isGameOver) return;

    let baseParallaxSpeed = 0.5; 
    let gameSpeed = currentWave * 0.1; 

    this.parallaxSprites.forEach(sprite => {
        if (sprite.tilePositionX !== undefined && sprite.parallaxSpeed > 0) {
            if (sprite.texture.key === 'clouds') {
                sprite.tilePositionX += sprite.parallaxSpeed; 
            } else {
                sprite.tilePositionX += (gameSpeed + baseParallaxSpeed) * sprite.parallaxSpeed;
            }
        }
    });

    this.buildings.forEach(prop => {
        prop.x -= (gameSpeed + baseParallaxSpeed) * prop.parallaxSpeed;
        
        if (prop.x < -300) {
            let rightmostX = 1280;
            this.buildings.forEach(p => { if (p.x > rightmostX) rightmostX = p.x; });
            
            prop.x = rightmostX + Phaser.Math.Between(500, 1200);
            prop.setTexture(Phaser.Utils.Array.GetRandom(PROP_KEYS)); 
        }
    });

    enemiesGroup.children.iterate(enemy => {
        if (enemy && enemy.active) {
            enemy.setDepth(enemy.y); 
            
            if (enemy.wordTextGroup) {
                // FIX: Brought text container closer to enemy heads
                enemy.wordTextGroup.setPosition(enemy.x, enemy.y - 45);
                enemy.wordTextGroup.setDepth(enemy.y + 1);
            }

            let dist = Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y);
            if (dist < MELEE_RANGE && enemy.anims.currentAnim.key !== 'attack') enemy.play('attack');
            else if (dist >= MELEE_RANGE && enemy.anims.currentAnim.key !== 'run') enemy.play('run');
        }
    });
}

function trySpawnEnemy() {
    if (isGameOver || enemiesGroup.countActive(true) >= MAX_ENEMIES_ON_SCREEN || currentWaveWords.length === 0) return;

    const spawnWord = currentWaveWords.pop();
    const laneY = LANES[Phaser.Math.Between(0, 2)];

    let enemy = enemiesGroup.create(1350, laneY, 'hero_run').setScale(2.5).setFlipX(true).setTint(0xff5555).play('run'); 
    
    let speedBase = 50 + (currentWave * 15);
    enemy.setVelocityX(-Phaser.Math.Between(speedBase, speedBase + 40));
    
    enemy.targetWord = spawnWord;
    enemy.typedIndex = 0;
    
    enemy.wordTextGroup = sceneRef.add.container(enemy.x, enemy.y - 45);
    
    // FIX: explicitly set the typedText color to green (#34d399) and untyped to white
    enemy.typedText = sceneRef.add.text(0, 0, "", { fontSize: '28px', fontStyle: 'bold', fill: '#34d399', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0.5);
    enemy.untypedText = sceneRef.add.text(0, 0, spawnWord, { fontSize: '28px', fontStyle: 'bold', fill: '#ffffff', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0.5);
    
    enemy.wordTextGroup.add([enemy.typedText, enemy.untypedText]);
}

// --- TARGET LOCK & COMBAT LOGIC ---
function handleTyping(event) {
    if (isGameOver) return;
    
    let char = event.key.toUpperCase();
    if (!/^[A-Z\-]$/.test(char)) return;

    if (sessionStats.startTime === 0) sessionStats.startTime = Date.now();
    sessionStats.totalKeystrokes++;

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
            
            if (activeTarget.typedIndex === activeTarget.targetWord.length) {
                executeAttack(activeTarget);
                activeTarget = null;
            }
        }
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
            activeTarget.untypedText.setTint(0xe11d48);
            setTimeout(() => { if (activeTarget && activeTarget.untypedText) activeTarget.untypedText.clearTint(); }, 200);
        }
    }
}

function updateEnemyText(enemy) {
    let typed = enemy.targetWord.substring(0, enemy.typedIndex);
    let untyped = enemy.targetWord.substring(enemy.typedIndex);
    
    // FIX: Make sure the text updates correctly AND forces the correct colors 
    enemy.typedText.setText(typed);
    enemy.typedText.setColor('#34d399'); // Force bright green on the typed portion
    
    enemy.untypedText.setText(untyped);
    enemy.untypedText.setColor('#facc15'); // Highlight the rest of the target word gold
}

function executeAttack(target) {
    let dist = Phaser.Math.Distance.Between(player.x, player.y, target.x, target.y);
    
    let now = Date.now();
    let timeTakenMins = (now - sessionStats.lastWordTime) / 60000;
    if(sessionStats.lastWordTime > 0) {
        let burst = Math.round((target.targetWord.length / 5) / timeTakenMins);
        if (burst > sessionStats.peakBurstWPM && burst < 300) sessionStats.peakBurstWPM = burst;
    }
    sessionStats.lastWordTime = now;

    player.play('attack');
    
    if (dist < MELEE_RANGE) {
        player.setTint(0xfacc15); 
        setTimeout(() => player.clearTint(), 100);
        killEnemy(target);
    } else {
        let proj = projectilesGroup.create(player.x + 30, player.y - 15, 'kunai');
        proj.setDepth(target.depth + 1);
        
        proj.setRotation(Phaser.Math.DegToRad(90));
        proj.setScale(0.25); 

        sceneRef.physics.moveToObject(proj, target, 1500); 
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
    
    let graphics = sceneRef.add.graphics().setDepth(enemy.depth);
    graphics.fillStyle(0xe11d48, 0.8);
    for (let i = 0; i < 8; i++) {
        let px = enemy.x + Phaser.Math.Between(-30, 30);
        let py = enemy.y - 40 + Phaser.Math.Between(-20, 20);
        graphics.fillRect(px, py, Phaser.Math.Between(4, 10), Phaser.Math.Between(4, 10));
    }
    sceneRef.tweens.add({ targets: graphics, alpha: 0, scale: 2, duration: 400, onComplete: () => graphics.destroy() });

    enemy.wordTextGroup.destroy();
    enemy.destroy();
    
    score += (currentWave * 10);
    document.getElementById('ui-score').innerText = score;
    
    enemiesDefeatedInWave++;
    
    if (currentWaveWords.length === 0 && enemiesGroup.countActive(true) === 0) {
        currentWave++;
        requestNextWave();
    }
}

async function takeDamage(playerObj, enemy) {
    if (!enemy.active) return;
    
    if (activeTarget === enemy) activeTarget = null;
    
    enemy.wordTextGroup.destroy();
    enemy.destroy();
    
    currentHealth -= ENEMY_DAMAGE;
    const hpFill = document.getElementById('ui-hp-fill');
    hpFill.style.width = Math.max(0, (currentHealth / PLAYER_MAX_HEALTH) * 100) + '%';
    if (currentHealth <= 30) hpFill.classList.add('danger');

    sceneRef.cameras.main.shake(200, 0.02);
    player.setTint(0xe11d48);
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

initializeGame();