// Load header info
let avatarUrl = localStorage.getItem('avatar');
if (avatarUrl && !avatarUrl.startsWith('http')) avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=Bot${avatarUrl}`;

document.getElementById('display-avatar').src = avatarUrl;
document.getElementById('display-gamertag').innerText = localStorage.getItem('gamertag');

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('gamertag');
    localStorage.removeItem('avatar');
    window.location.href = 'index.html';
}

// Fetch user data on load
async function fetchUserData() {
    const token = localStorage.getItem('token');
    
    try {
        const res = await fetch('/api/account', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const user = await res.json();
            populateDashboard(user);
        } else {
            // Token might be expired
            logout();
        }
    } catch (err) {
        console.error("Error fetching account data:", err);
    }
}

function populateDashboard(user) {
    let dbAvatar = user.avatar;
    if (dbAvatar && !dbAvatar.startsWith('http')) dbAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=Bot${dbAvatar}`;
    
    document.getElementById('profile-avatar-large').src = dbAvatar;
    document.getElementById('profile-gamertag-large').innerText = user.gamertag;
    // Fill in the input fields
    document.getElementById('update-gamertag').value = user.gamertag;

    // Fill in the global stats
    document.getElementById('skill-score').innerText = user.skillScore;
    document.getElementById('avg-wpm').innerText = user.globalMetrics.avgWpm;
    document.getElementById('avg-acc').innerText = user.globalMetrics.avgAccuracy;
    document.getElementById('peak-burst').innerText = user.globalMetrics.peakBurstSpeed;
    
    // Fill in game-specific records
    document.getElementById('tr-played').innerText = user.games.turboRacing.played;
    document.getElementById('tr-wins').innerText = user.games.turboRacing.wins;
    document.getElementById('sam-wave').innerText = user.games.samuraiTyping.highestWave;
    
    document.getElementById('syntax-played').innerText = user.games.syntaxArena?.played || 0;
    document.getElementById('syntax-wins').innerText = user.games.syntaxArena?.wins || 0;
    document.getElementById('raid-played').innerText = user.games.colosseumRaid?.played || 0;
    document.getElementById('raid-damage').innerText = user.games.colosseumRaid?.totalDamage || 0;
    
    // NEW: Neon Royale
    document.getElementById('neon-played').innerText = user.games.neonRoyale?.played || 0;
    document.getElementById('neon-wins').innerText = user.games.neonRoyale?.wins || 0;
    
    // Placeholder for leaderboard percentiles
    document.getElementById('rank-percentile').innerText = "Top 10"; 
}

// Handle Profile Updates
document.getElementById('update-btn').addEventListener('click', async () => {
    const gamertag = document.getElementById('update-gamertag').value;
    const password = document.getElementById('update-pass').value;
    const msgEl = document.getElementById('update-msg');
    const token = localStorage.getItem('token');

    try {
        const res = await fetch('/api/account/update', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ gamertag, password })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            msgEl.style.color = "#10b981"; // Green
            msgEl.innerText = "Profile updated successfully!";
            
            // Update local storage and header if gamertag changed
            if (gamertag) {
                localStorage.setItem('gamertag', gamertag);
                document.getElementById('display-gamertag').innerText = gamertag;
            }
        } else {
            msgEl.style.color = "#ef4444"; // Red
            msgEl.innerText = data.error;
        }
    } catch (err) {
        msgEl.style.color = "#ef4444";
        msgEl.innerText = "Connection error.";
    }
});

// Run fetch immediately
fetchUserData();