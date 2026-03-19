function toggleAuth() {
    const loginSec = document.getElementById('login-section');
    const signupSec = document.getElementById('signup-section');
    const errorMsg = document.getElementById('auth-error');
    errorMsg.style.display = 'none';
    if (loginSec.style.display === 'none') {
        loginSec.style.display = 'block'; signupSec.style.display = 'none';
    } else {
        loginSec.style.display = 'none'; signupSec.style.display = 'block';
    }
}

document.getElementById('signup-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reg-email').value;
    const gamertag = document.getElementById('reg-gamertag').value;
    const password = document.getElementById('reg-pass').value;
    const avatar = document.getElementById('reg-avatar').value;

    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, gamertag, password, avatar })
        });
        const data = await res.json();
        if (res.ok) { alert("Account created! Please log in."); toggleAuth(); } 
        else { showError(data.error); }
    } catch (err) { showError("Failed to connect to server."); }
});

document.getElementById('login-btn')?.addEventListener('click', async () => {
    const loginIdentifier = document.getElementById('login-id').value;
    const password = document.getElementById('login-pass').value;

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
            
            // LINK FORWARDING LOGIC
            const urlParams = new URLSearchParams(window.location.search);
            const redirectUrl = urlParams.get('redirect');
            if (redirectUrl) {
                window.location.href = redirectUrl;
            } else {
                const activeRoomUrl = localStorage.getItem('activeRoomUrl');
                window.location.href = activeRoomUrl ? activeRoomUrl : 'hub.html';
            }
        } else { showError(data.error); }
    } catch (err) { showError("Failed to connect to server."); }
});

function showError(msg) {
    const errObj = document.getElementById('auth-error');
    errObj.innerText = msg; errObj.style.display = 'block';
}