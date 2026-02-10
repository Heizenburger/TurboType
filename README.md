# 🚀 TurboType: Gamified Proficiency System

> *"Transforming repetitive typing drills into high-stakes interactive gameplay."*

![Project Status](https://img.shields.io/badge/Status-Pre--Alpha-orange)
![Tech Stack](https://img.shields.io/badge/Engine-Phaser_3-blue)
![Backend](https://img.shields.io/badge/Backend-Node.js_%2B_Socket.io-green)

## 📖 Overview
**TurboType** is a web-based educational game designed to bridge the gap between monotonous typing drills and engaging skill acquisition.

By leveraging **"Flow State" psychology**, the system adapts to the user's typing speed, forcing them to maintain rhythm and accuracy to survive. Unlike static tutors, mistakes in TurboType have immediate visual consequences—losing health or falling behind in a race.

---

## 🎮 Game Modes

### ⚔️ 1. Samurai Survival (Single Player)
* **Objective:** Defend yourself against waves of enemies by typing words before they reach you.
* **Mechanics:**
    * **Range Check:** Enemies can only be killed when they enter "Kill Range."
    * **Dynamic Animation:** Enemies switch from running to attacking based on proximity.
    * **Health System:** Missed words or close-range hits drain your HP.

### 🏎️ 2. Turbo Racing (Multiplayer 1v1)
* **Objective:** Race against a live opponent by typing a paragraph faster and more accurately.
* **Mechanics:**
    * **Real-time Sync:** Uses **Socket.io** to sync car positions instantly.
    * **Live WPM:** See your speed calculated in real-time as you drive.
    * **Lobby System:** Wait for a challenger to join your room.

---

## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript (ES6+)
* **Game Engine:** Phaser.js (v3.80)
* **Backend:** Node.js & Express
* **Real-time Communication:** Socket.io
* **Assets:** Custom Pixel Art (Aseprite)

---

## ⚡ How to Run Locally
Since this project uses a backend server for multiplayer features, you cannot just open the HTML file.

**Prerequisites:**
* [Node.js](https://nodejs.org/) installed (v14+ recommended).

**Steps:**
1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/TurboType.git](https://github.com/YOUR_USERNAME/TurboType.git)
    cd TurboType
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Start the Server:**
    ```bash
    node server.js
    ```

4.  **Play:**
    * Open your browser and visit: `http://localhost:3000`
    * Select **"Samurai Survival"** or **"Turbo Racing"** from the main hub.

---

## 🔮 Future Scope
* **Vertical Platformer Mode:** A "Keyboard Jump" style game for vertical scrolling practice.
* **Global Leaderboards:** Persistent database to track high scores.
* **AI Difficulty:** Enemies that adapt speed based on your average WPM.

---

## 👥 Team Members
* **Aman Adil** (300102223013)
* **Amit Sahu** (300102223015)
* **Anupam Sharma** (300102223023)
