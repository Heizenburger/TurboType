function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('gamertag');
    localStorage.removeItem('avatar');
    window.location.href = 'index.html';
}

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
            logout();
        }
    } catch (err) {
        console.error("Error fetching account data:", err);
    }
}

// Helper function to animate Win-Rate Progress Bars
function updateProgressBar(barId, wins, played) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    
    if (played === 0) {
        bar.style.width = '0%';
        return;
    }
    
    const winRate = (wins / played) * 100;
    // Delay the width expansion so it triggers after the CSS boot-up animation
    setTimeout(() => {
        bar.style.width = `${winRate}%`;
        
        // Dynamic Neon Colors
        if (winRate >= 50) {
            bar.style.backgroundColor = '#10b981'; // Success Green
            bar.style.color = '#10b981';
        } else if (winRate >= 30) {
            bar.style.backgroundColor = '#f59e0b'; // Warning Orange
            bar.style.color = '#f59e0b';
        } else {
            bar.style.backgroundColor = '#ef4444'; // Danger Red
            bar.style.color = '#ef4444';
        }
    }, 800); 
}

function populateDashboard(user) {
    let dbAvatar = user.avatar;
    if (dbAvatar && !dbAvatar.startsWith('http')) dbAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=Bot${dbAvatar}`;
    
    document.getElementById('profile-avatar-large').src = dbAvatar;
    document.getElementById('profile-gamertag-large').innerText = user.gamertag;
    document.getElementById('update-gamertag').value = user.gamertag;

    // Set Dynamic Hacker Rank based on Skill Score
    const score = user.skillScore || 0;
    const rankEl = document.getElementById('hacker-rank');
    if (score >= 1500) {
        rankEl.innerText = "CYBER NINJA";
        rankEl.style.color = "#a855f7"; // Purple
    } else if (score >= 500) {
        rankEl.innerText = "NETRUNNER";
        rankEl.style.color = "#3b82f6"; // Blue
    } else {
        rankEl.innerText = "SCRIPT KIDDIE";
        rankEl.style.color = "#94a3b8"; // Slate
    }

    document.getElementById('skill-score').innerText = score;
    document.getElementById('avg-wpm').innerText = user.globalMetrics?.avgWpm || 0;
    document.getElementById('avg-acc').innerText = user.globalMetrics?.avgAccuracy || 0;
    document.getElementById('peak-burst').innerText = user.globalMetrics?.peakBurstSpeed || 0;
    
    const trWins = user.games?.turboRacing?.wins || 0;
    const trPlayed = user.games?.turboRacing?.played || 0;
    document.getElementById('tr-played').innerText = trPlayed;
    document.getElementById('tr-wins').innerText = trWins;
    updateProgressBar('tr-bar', trWins, trPlayed);

    const synWins = user.games?.syntaxArena?.wins || 0;
    const synPlayed = user.games?.syntaxArena?.played || 0;
    document.getElementById('syntax-played').innerText = synPlayed;
    document.getElementById('syntax-wins').innerText = synWins;
    updateProgressBar('syntax-bar', synWins, synPlayed);

    // NEW: Populating Neon Royale Stats
    const neonWins = user.games?.neonRoyale?.wins || 0;
    const neonPlayed = user.games?.neonRoyale?.played || 0;
    document.getElementById('neon-played').innerText = neonPlayed;
    document.getElementById('neon-wins').innerText = neonWins;
    updateProgressBar('neon-bar', neonWins, neonPlayed);

    document.getElementById('sam-wave').innerText = user.games?.samuraiTyping?.highestWave || 0;
    document.getElementById('raid-played').innerText = user.games?.colosseumRaid?.played || 0;
    document.getElementById('raid-damage').innerText = user.games?.colosseumRaid?.totalDamage || 0;
    
    document.getElementById('rank-percentile').innerText = "Top 10"; 
}

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
            msgEl.style.color = "#10b981"; 
            msgEl.innerText = "OVERRIDE SUCCESSFUL.";
            
            if (gamertag) {
                localStorage.setItem('gamertag', gamertag);
                document.getElementById('profile-gamertag-large').innerText = gamertag;
            }
        } else {
            msgEl.style.color = "#ef4444"; 
            msgEl.innerText = data.error;
        }
    } catch (err) {
        msgEl.style.color = "#ef4444";
        msgEl.innerText = "CONNECTION FAILED.";
    }
});

fetchUserData();