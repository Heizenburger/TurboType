# 🚀 TurboType: Gamified Proficiency System

> *"Transforming repetitive typing drills into high-stakes interactive gameplay."*

![Project Status](https://img.shields.io/badge/Status-Alpha-orange)
![Tech Stack](https://img.shields.io/badge/Engine-Phaser_3-blue)
![Backend](https://img.shields.io/badge/Backend-Node.js_%2B_Socket.io-green)
![AI](https://img.shields.io/badge/AI-Google_Gemini-purple)

## 📖 Overview
**TurboType** is a web-based educational game designed to bridge the gap between monotonous typing drills and engaging skill acquisition.

By leveraging **"Flow State" psychology**, the system adapts to the user's typing speed, forcing them to maintain rhythm and accuracy to survive. Unlike static tutors, mistakes in TurboType have immediate visual consequences—losing health or falling behind in a race.

---

## 🎮 Game Modes

### ⚔️ 1. Samurai Survival (Single Player)
* **Objective:** Defend yourself against waves of enemies by typing words before they reach you.
* **Mechanics:**
    * **Range Check:** Enemies can only be killed when they enter "Kill Range."
    * **Adaptive Difficulty:** The game engine dynamically adjusts game speed, enemy spawn rates, and word complexity based on your real-time score and typing proficiency.
    * **Health System:** Missed words or close-range hits drain your HP.

### 🏎️ 2. Turbo Racing (Multiplayer 1v1)
* **Objective:** Race against a live opponent by typing a paragraph faster and more accurately.
* **Mechanics:**
    * **Real-time Sync:** Uses **Socket.io** to sync car positions instantly across different clients.
    * **AI Integration:** Features dynamic text generation powered by the **Google Gemini API**, automatically adjusting the paragraph's vocabulary and punctuation complexity based on the lobby's selected difficulty tier.
    * **Live WPM:** See your speed calculated in real-time as you drive.

---

## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript (ES6+)
* **Game Engine:** Phaser.js (v3.80)
* **Backend:** Node.js & Express
* **Real-time Communication:** Socket.io
* **Artificial Intelligence:** Google Generative AI (Gemini 2.5 Flash)
* **Assets:** Custom Pixel Art (Aseprite)

---

## ⚡ How to Run Locally
Since this project uses a backend server for multiplayer features and AI generation, you cannot just open the HTML file.

**Prerequisites:**
* [Node.js](https://nodejs.org/) installed (v14+ recommended).
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
    * Add your Gemini API key inside it like this:
      ```text
      GEMINI_API_KEY=your_api_key_here
      ```

4.  **Start the Server:**
    ```bash
    node server.js
    ```

5.  **Play:**
    * Open your browser and visit: `http://localhost:3000`
    * Select **"Samurai Survival"** or **"Turbo Racing"** from the main hub.

---

## 🔮 Future Scope
* **Global Leaderboards:** Implementation of a competitive ranking database to track top player statistics and high scores across various game modes.
* **Syntax Arena (PvP):** A developer-focused competitive mode where players battle by rapidly and accurately typing programming language syntax and code snippets instead of standard prose.
* **Colosseum Raid (Co-op Boss Battle):** A real-time PvE mode where a team of players cooperates to defeat a massive boss by typing continuously from a shared pool of epic lore to collaboratively drain a global HP bar.

---

## 👥 Team Members
* **Aman Adil** (300102223013)
* **Amit Sahu** (300102223015)
* **Anupam Sharma** (300102223023)
