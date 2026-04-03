// --- CURRICULUM DATA ---
const curriculum = [
    { id: 1, title: "1. Core: F & J", text: "f j fj jf f f j j f j fj jf", passAcc: 95 },
    { id: 2, title: "2. Core: D & K", text: "d k dk kd f d j k df kj", passAcc: 95 },
    { id: 3, title: "3. Core: S & L", text: "s l sl ls d s k l sf jl", passAcc: 95 },
    { id: 4, title: "4. Core: A & ;", text: "a ; a; ;a s a l ; af j;", passAcc: 95 },
    { id: 5, title: "5. Home Row Master", text: "asdf jkl; asdf jkl; fdsa ;lkj", passAcc: 98 },
    { id: 6, title: "6. Top Row: E & I", text: "e i ed ik de ki e d i k", passAcc: 95 },
    { id: 7, title: "7. Top Row: R & U", text: "r u rf uj fr ju r f u j", passAcc: 95 },
];

let currentLessonIndex = 0;
let targetText = "";
let characters = [];
let currentCharIndex = 0;

let startTime = 0;
let errors = 0;
let isTyping = false;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    buildSidebar();
    loadLesson(0);

    const input = document.getElementById('hidden-input');
    input.focus();
    document.addEventListener('click', () => input.focus());
    input.addEventListener('input', handleTyping);

    // Toggle Keyboard Zones
    document.getElementById('toggle-zones').addEventListener('change', (e) => {
        const kb = document.getElementById('virtual-keyboard');
        if (e.target.checked) kb.classList.add('show-zones');
        else kb.classList.remove('show-zones');
    });

    // Keyboard Visual Feedback (Physical presses down)
    document.addEventListener('keydown', (e) => animateKeyPress(e.key, true));
    document.addEventListener('keyup', (e) => animateKeyPress(e.key, false));
});

function buildSidebar() {
    const list = document.getElementById('lesson-list');
    list.innerHTML = '';
    curriculum.forEach((lesson, index) => {
        const btn = document.createElement('div');
        btn.className = `lesson-btn ${index === currentLessonIndex ? 'active' : ''}`;
        btn.innerText = lesson.title;
        btn.onclick = () => loadLesson(index);
        list.appendChild(btn);
    });
}

function loadLesson(index) {
    currentLessonIndex = index;
    const lesson = curriculum[index];
    
    document.getElementById('current-module-name').innerText = lesson.title;
    targetText = lesson.text;
    characters = targetText.split('');
    currentCharIndex = 0;
    errors = 0;
    isTyping = false;
    startTime = 0;
    
    document.getElementById('live-acc').innerText = "100%";
    document.getElementById('live-acc').style.color = "#34d399";
    document.getElementById('live-wpm').innerText = "0 WPM";
    document.getElementById('hidden-input').value = "";

    buildSidebar();
    renderText();
    highlightTargetKey();
}

function renderText() {
    const html = characters.map((char, i) => {
        let classes = "char ";
        if (i === currentCharIndex) classes += "current";
        // Space characters need a visible representation if they are errors
        const displayChar = char === " " ? "&nbsp;" : char;
        return `<span class="${classes}" id="char-${i}">${displayChar}</span>`;
    }).join('');
    
    document.getElementById('target-text').innerHTML = html;
}

// --- TYPING ENGINE ---
function handleTyping(e) {
    const val = e.target.value;
    const typedChar = val.slice(-1); // Get the last typed character
    
    if (!isTyping) {
        isTyping = true;
        startTime = Date.now();
    }

    const expectedChar = characters[currentCharIndex];
    const charSpan = document.getElementById(`char-${currentCharIndex}`);

    if (typedChar === expectedChar) {
        charSpan.classList.remove('current', 'error');
        charSpan.classList.add('correct');
        currentCharIndex++;
        
        // Setup next character
        if (currentCharIndex < characters.length) {
            document.getElementById(`char-${currentCharIndex}`).classList.add('current');
            highlightTargetKey();
        } else {
            finishLesson();
        }
    } else {
        // Typo
        errors++;
        charSpan.classList.add('error');
        // Vibrate the text box to signal error
        const textWindow = document.getElementById('text-window');
        textWindow.style.transform = 'translateX(5px)';
        setTimeout(() => textWindow.style.transform = 'translateX(-5px)', 50);
        setTimeout(() => textWindow.style.transform = 'translateX(0)', 100);
    }
    
    // Prevent the input box from overflowing
    if(val.length > 5) e.target.value = ""; 

    updateStats();
}

function updateStats() {
    if (currentCharIndex === 0) return;
    
    const acc = Math.max(0, Math.round(((currentCharIndex - errors) / currentCharIndex) * 100));
    document.getElementById('live-acc').innerText = `${acc}%`;
    document.getElementById('live-acc').style.color = acc >= curriculum[currentLessonIndex].passAcc ? "#34d399" : "#ef4444";

    const timeMins = (Date.now() - startTime) / 60000;
    const wpm = Math.round((currentCharIndex / 5) / timeMins) || 0;
    document.getElementById('live-wpm').innerText = `${wpm} WPM`;
}

// --- VIRTUAL KEYBOARD ENGINE ---
function highlightTargetKey() {
    // Remove old target
    document.querySelectorAll('.key').forEach(k => k.classList.remove('target-key'));
    
    if (currentCharIndex >= characters.length) return;

    const expectedChar = characters[currentCharIndex].toLowerCase();
    const keyDiv = document.querySelector(`.key[data-key="${expectedChar}"]`);
    
    if (keyDiv) keyDiv.classList.add('target-key');
}

function animateKeyPress(key, isDown) {
    const k = key.toLowerCase();
    const keyDiv = document.querySelector(`.key[data-key="${k}"]`);
    if (keyDiv) {
        if (isDown) keyDiv.classList.add('pressed');
        else keyDiv.classList.remove('pressed');
    }
}

// --- COMPLETION ---
function finishLesson() {
    isTyping = false;
    document.getElementById('hidden-input').disabled = true;
    
    const acc = Math.max(0, Math.round(((characters.length - errors) / characters.length) * 100));
    const passRequirement = curriculum[currentLessonIndex].passAcc;
    const passed = acc >= passRequirement;

    document.getElementById('final-acc').innerText = `${acc}% (Req: ${passRequirement}%)`;
    document.getElementById('final-acc').style.color = passed ? "#34d399" : "#ef4444";
    
    const timeMins = (Date.now() - startTime) / 60000;
    document.getElementById('final-wpm').innerText = `${Math.round((characters.length / 5) / timeMins)} WPM`;

    const msg = document.getElementById('pass-fail-msg');
    const nextBtn = document.getElementById('next-module-btn');

    if (passed) {
        msg.innerText = "Calibration Successful.";
        msg.style.color = "#34d399";
        
        if (currentLessonIndex < curriculum.length - 1) {
            nextBtn.style.display = "inline-block";
            nextBtn.onclick = () => {
                document.getElementById('end-modal').style.display = 'none';
                document.getElementById('hidden-input').disabled = false;
                loadLesson(currentLessonIndex + 1);
            };
        } else {
            msg.innerText = "Curriculum Complete. You are ready for the Arena.";
            nextBtn.style.display = "none";
        }
    } else {
        msg.innerText = "Calibration Failed. High error rate detected.";
        msg.style.color = "#ef4444";
        nextBtn.style.display = "inline-block";
        nextBtn.innerText = "RETRY MODULE";
        nextBtn.onclick = () => {
            document.getElementById('end-modal').style.display = 'none';
            document.getElementById('hidden-input').disabled = false;
            loadLesson(currentLessonIndex);
        };
    }

    document.getElementById('end-modal').style.display = 'flex';
}