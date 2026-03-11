# 🎱 Pool League

A local multiplayer pool league tracker with **ELO ratings**, player profiles, and game history. Run it on your local network so anyone can record results from their phone or browser.

---

## Features

- **ELO rating system** — ratings update automatically after every game
- **League table** — players ranked by current ELO rating
- **Player profiles** — detailed stats per player including:
  - Win/loss record & win percentage
  - Current streak, longest win streak, longest loss streak
  - Highest & lowest ELO ever reached
  - Last 5 results
  - ELO rating history chart
- **Game history** — full log of all recorded results
- **Network accessible** — accessible from any device on the same Wi-Fi

---

## Tech Stack

- **Backend:** Node.js with [Express](https://expressjs.com/)
- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **Data storage:** JSON file (`data/db.json`)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)

### Installation

```bash
# Clone or download the project, then install dependencies
npm install
```

### Running the Server

```bash
npm start
```

The server will start on port **3000**. Open your browser and go to:

- **Local:** [http://localhost:3000](http://localhost:3000)
- **Network:** `http://<your-local-ip>:3000` (displayed in the terminal on startup)

---

## Project Structure

```
pool_league/
├── index.js          # Express server & API routes
├── package.json
├── data/
│   └── db.json       # Persistent data store (players & games)
└── public/
    ├── index.html    # Main league table & record game page
    ├── player.html   # Individual player profile page
    ├── css/
    │   ├── main.css
    │   ├── index.css
    │   └── player.css
    └── js/
        ├── index.js  # Frontend logic for main page
        └── player.js # Frontend logic for player profile
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/players` | Get all players sorted by rating |
| `POST` | `/api/players` | Add a new player `{ name }` |
| `GET` | `/api/players/:id/profile` | Get full stats for a player |
| `GET` | `/api/games` | Get all games (most recent first) |
| `POST` | `/api/games` | Record a game result `{ winnerId, loserId }` |

---

## ELO Rating System

The league uses the standard **ELO formula** with a K-factor of **32**.

- Every new player starts at **1000**
- After each game, the winner gains points and the loser loses points
- The amount transferred depends on the rating difference — beating a higher-rated opponent earns more points than beating a lower-rated one

---

## Data Storage

All data is stored in `data/db.json`. This file is created automatically on first run. Back it up regularly to avoid losing league history.

