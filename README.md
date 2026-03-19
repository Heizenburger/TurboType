# 🚀 TurboType: Gamified Proficiency System

> *"Transforming repetitive typing drills into high-stakes interactive gameplay."*

![Project Status](https://img.shields.io/badge/Status-Beta-orange)
![Tech Stack](https://img.shields.io/badge/Engine-Phaser_3-blue)
![Backend](https://img.shields.io/badge/Backend-Node.js_%2B_Socket.io-green)
![Database](https://img.shields.io/badge/Database-MongoDB-brightgreen)
![AI](https://img.shields.io/badge/AI-Google_Gemini-purple)

## 📖 Overview
**TurboType** is a full-stack web-based educational game designed to bridge the gap between monotonous typing drills and engaging skill acquisition. 

By leveraging **"Flow State" psychology**, the system adapts to the user's typing speed, forcing them to maintain rhythm and accuracy to survive. Backed by a persistent unified room architecture, players track their global skill scores, average WPM, and accuracy across multiple competitive and cooperative game modes.

---

## 🎮 Game Modes

### ⚔️ 1. Samurai Survival (Single Player)
* **Objective:** Defend yourself against waves of enemies by typing words before they reach you.
* **Mechanics:**
    * **Range Check:** Enemies can only be killed when they enter "Kill Range."
    * **Adaptive Difficulty:** Enemy speed, damage, and word complexity scale dynamically based on your global Skill Score.
    * **Health System:** Missed words or close-range hits drain your HP.

### 🏎️ 2. Turbo Racing (Multiplayer 1v1)
* **Objective:** Race against a live opponent by typing a paragraph faster and more accurately.
* **Mechanics:**
    * **Real-time Sync:** Uses **Socket.io** to sync car positions instantly across clients.
    * **AI Generation:** Integrates **Google Gemini API** to dynamically generate custom track text based on the lobby's skill ceiling.
    * **Hazards & Nitro:** Perfect streaks trigger Nitro boosts, while typos on "Hazard" words cause your car to spin out and lose progress.

### 💻 3. Syntax Arena (PvP Tug-of-War)
* **Objective:** A developer-focused competitive mode where players battle by rapidly typing programming language syntax (JS, Python, C++, etc.).
* **Mechanics:**
    * **Physics Engine:** Correct keystrokes pull the glowing "Data Core" toward the opponent in a 30-FPS server-side tug-of-war.
    * **System Shock:** Typos violently shake your terminal and lock your keyboard for 1 second.

### 🐉 4. Colosseum Raid (Co-op PvE)
* **Objective:** Team up with other players in real-time to defeat a massive Global Boss with a 5000 HP pool.
* **Mechanics:**
    * **Shared Server State:** All players in the room attack the same boss by typing epic lore. Longer words deal more damage.
    * **Crash Recovery:** Disconnects are handled gracefully, allowing players 60 seconds to rejoin the active raid without losing progress.

---

## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript (ES6+)
* **Game Engine:** Phaser.js (v3.80)
* **Backend:** Node.js & Express.js
* **Real-time Communication:** Socket.io
* **Database & Auth:** MongoDB, Mongoose, JWT (JSON Web Tokens)
* **Artificial Intelligence:** Google Generative AI (Gemini 2.5 Flash)
* **Assets:** Custom Pixel Art (Aseprite)

---

## ⚡ How to Run Locally
Since this project uses a persistent database, secure authentication, and AI features, you must set up your environment variables before running.

**Prerequisites:**
* [Node.js](https://nodejs.org/) installed (v16+ recommended).
* A free [MongoDB Atlas](https://www.mongodb.com/atlas) Cluster URI.
* A free [Google Gemini API Key](https://aistudio.google.com/).

**Steps:**
1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/Heizenburger/TurboType.git](https://github.com/Heizenburger/TurboType.git)
    cd TurboType
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Set Up Environment Variables:**
    * Create a file named `.env` in the root folder.
    * Add your secure keys inside it like this:
      ```text
      MONGO_URI=your_mongodb_connection_string
      JWT_SECRET=your_super_secret_jwt_key
      GEMINI_API_KEY=your_gemini_api_key
      PORT=3000
      ```

4.  **Start the Server:**
    ```bash
    npm start
    ```

5.  **Play:**
    * Open your browser and visit: `http://localhost:3000`
    * Create an account and enter the Hub!

---

## 🔮 Future Scope
* **Vertical Platformer Mode:** A "Keyboard Jump" style game for vertical scrolling practice.
* **Custom Avatars & Cosmetics:** Unlockable car skins and Samurai weapons using points earned from matches.
* **Clan System:** Form developer guilds to compete in aggregate monthly leaderboards.

---

## 👥 Team Members
* **Aman Adil** (300102223013)
* **Amit Sahu** (300102223015)
* **Anupam Sharma** (300102223023)
