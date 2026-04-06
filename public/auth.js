// --- CINEMATIC INTRO ANIMATION ---
window.onload = () => {
    const titleText = "TURBO TYPE";
    const bigEl = document.getElementById('big-typing-title');
    let i = 0;
    
    function typeWriter() {
        if (i < titleText.length) {
            bigEl.innerHTML += titleText.charAt(i);
            i++;
            setTimeout(typeWriter, 120);
        } else {
            bigEl.classList.remove('typing-cursor');
            
            // Hold the big title for a moment, then fade/shrink out
            setTimeout(() => {
                const overlay = document.getElementById('intro-overlay');
                overlay.style.opacity = '0';
                overlay.style.transform = 'scale(0.8) translateY(-100px)';
                
                // Fade in the main UI
                document.getElementById('ui-container').style.opacity = '1';

                // Completely remove overlay so it doesn't block clicks
                setTimeout(() => overlay.style.display = 'none', 1000);
            }, 800); 
        }
    }
    setTimeout(typeWriter, 500); 
    populateAvatars();
};

// --- EXTENSIVE AVATAR LIST ---
const avatarSeeds = [
    "Ninja", "Racer", "Hacker", "Cyborg", "Ghost", "Samurai", 
    "Ronin", "Knight", "Wizard", "Jester", "Goblin", "Pirate", 
    "Sniper", "Medic", "Tank", "Drone", "Alien", "Mutant", 
    "Viper", "Striker", "Reaper", "Phantom", "Titan", "Wraith"
];

function populateAvatars() {
    const gallery = document.getElementById('avatar-gallery');
    let html = '';
    avatarSeeds.forEach((seed, index) => {
        let isSelected = index === 0 ? "selected" : "";
        html += `
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${seed}" 
                 class="avatar-option ${isSelected}" 
                 data-avatar="${seed}" 
                 onclick="selectAvatar(this)" 
                 title="${seed}">
        `;
    });
    gallery.innerHTML = html;
}

function selectAvatar(imgEl) {
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    imgEl.classList.add('selected');
    document.getElementById('reg-avatar').value = imgEl.getAttribute('data-avatar');
}


// --- UI SECTION ROUTING ---
function switchSection(sectionId) {
    ['login-section', 'signup-section', 'otp-section', 'forgot-section'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById(sectionId).style.display = 'block';
    document.querySelectorAll('p[id^="auth-error"]').forEach(el => el.style.display = 'none');
}

function showError(msg, section) {
    const errObj = document.getElementById(`auth-error-${section}`);
    errObj.innerText = msg;
    errObj.style.display = 'block';
    if (msg.includes('SUCCESS')) errObj.style.color = '#10b981';
    else errObj.style.color = '#ef4444';
}


// --- 1. LOGIN ---
document.getElementById('login-btn')?.addEventListener('click', async () => {
    const loginIdentifier = document.getElementById('login-id').value;
    const password = document.getElementById('login-pass').value;
    const btn = document.getElementById('login-btn');

    btn.innerText = "AUTHENTICATING...";
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginIdentifier, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('gamertag', data.gamertag);
            localStorage.setItem('avatar', data.avatar);
            
            const urlParams = new URLSearchParams(window.location.search);
            const redirectUrl = urlParams.get('redirect');
            window.location.href = redirectUrl ? redirectUrl : (localStorage.getItem('activeRoomUrl') || 'hub.html');
        } else { showError(data.error, 'login'); btn.innerText = "ENTER MAINFRAME"; }
    } catch (err) { showError("Failed to connect to server.", 'login'); btn.innerText = "ENTER MAINFRAME"; }
});


// --- 2. SEND OTP (Signup Step 1) ---
document.getElementById('signup-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    const gamertag = document.getElementById('reg-gamertag').value;
    const password = document.getElementById('reg-pass').value;
    const btn = document.getElementById('signup-btn');

    if (!email || !gamertag || !password) return showError("All fields are required.", 'signup');

    btn.innerText = "TRANSMITTING...";
    try {
        const res = await fetch('/api/send-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, gamertag })
        });
        const data = await res.json();
        if (res.ok) { 
            switchSection('otp-section'); 
        } 
        else { showError(data.error, 'signup'); }
    } catch (err) { showError("Failed to connect to server.", 'signup'); }
    btn.innerText = "TRANSMIT CREDENTIALS";
});


// --- 3. VERIFY OTP (Signup Step 2) ---
document.getElementById('verify-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    const gamertag = document.getElementById('reg-gamertag').value;
    const password = document.getElementById('reg-pass').value;
    const avatar = document.getElementById('reg-avatar').value;
    const otp = document.getElementById('otp-code').value;
    const btn = document.getElementById('verify-btn');

    btn.innerText = "VERIFYING...";
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, gamertag, password, avatar, otp })
        });
        const data = await res.json();
        if (res.ok) { 
            alert("Security Clearance Granted. Please log in."); 
            switchSection('login-section');
            document.getElementById('login-id').value = gamertag;
        } 
        else { showError(data.error, 'otp'); }
    } catch (err) { showError("Failed to connect to server.", 'otp'); }
    btn.innerText = "VERIFY & INITIALIZE";
});


// --- 4. FORGOT PASSWORD ---
document.getElementById('reset-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value;
    const btn = document.getElementById('reset-btn');

    if (!email) return showError("Email is required.", 'forgot');

    btn.innerText = "TRANSMITTING...";
    try {
        const res = await fetch('/api/forgot-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) { 
            showError("SUCCESS: " + data.message, 'forgot'); 
        } else { 
            showError(data.error, 'forgot'); 
        }
    } catch (err) { showError("Failed to connect to server.", 'forgot'); }
    btn.innerText = "TRANSMIT NEW PASSWORD";
});

// Floating Background Keys Interaction
document.addEventListener('mousemove', (e) => {
    const keys = document.querySelectorAll('.floating-key');
    keys.forEach(key => {
        const rect = key.getBoundingClientRect();
        const keyCenterX = rect.left + rect.width / 2;
        const keyCenterY = rect.top + rect.height / 2;
        const dist = Math.hypot(e.clientX - keyCenterX, e.clientY - keyCenterY);

        if (dist < 150) {
            const pushX = ((keyCenterX - e.clientX) / dist) * 30;
            const pushY = ((keyCenterY - e.clientY) / dist) * 30;
            key.style.transform = `translate(${pushX}px, ${pushY}px) scale(1.2)`;
            key.classList.add('active');
        } else {
            key.style.transform = `translate(0px, 0px) scale(1)`;
            key.classList.remove('active');
        }
    });
});