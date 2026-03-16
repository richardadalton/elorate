# 🎱 Elorate — League Tracker

![Deploy](https://github.com/richarddalton/pool_league/actions/workflows/deploy.yml/badge.svg)

---

## About This Project

This project was an **experiment in AI-assisted development**. Every line of code was written by [GitHub Copilot](https://github.com/features/copilot) (powered by Claude). No code was written by hand.

The goal was to explore how far a non-trivial application could be taken through conversation alone — starting from a blank project and evolving it iteratively based on feedback, questions, and design discussions.

### How the human influenced the project

While the AI wrote all the code, the direction, priorities, and many of the key design decisions came from the conversations. Some examples:

- **Choosing the domain** — a pool league tracker, something real and personal rather than a toy example
- **Questioning architectural choices** — e.g. *"If we switch between leagues will we need to replay the log every time?"* led to the in-memory cache design
- **Pushing for cleaner data models** — the move to append-only JSONL files, the removal of stored ratings from the game log, and the player-aggregate approach all came from probing questions like *"Do we actually need this in the file?"* and *"How about we stop storing the impact of individual games on ratings entirely?"*
- **Scope decisions** — choosing which features to add (badges, King of the Hill, rival/nemesis, form guide, avatars), which to remove (longest losing streak record, ELO history chart), and which to defer
- **Identifying bugs** — spotting that the Grand Slam badge behaved inconsistently for tied records, that new players with no games were eligible for ELO records, and that avatars were attached to players rather than users
- **Deployment decisions** — choosing Fly.io, Docker, and the volume mount approach for persistent data
- **Design taste** — UI layout decisions, naming (Grand Slam, King of the Hill, Nemesis), and the overall aesthetic direction
- **Knowing when to stop** — the project was deliberately kept as a lean, vanilla HTML/CSS/JS app with no frontend framework, no database, and no build step

### What this shows

A focused, production-ready web application with a thoughtful architecture can be built entirely through conversation with an AI assistant in **~20–25 hours of active effort** across 3 days. The human's role shifts from writing code to making decisions, asking the right questions, and knowing what good looks like.

---


## Features

- **User accounts** — register and sign in to join leagues, record games, and claim your player profile. Guest players (added without an account) can be claimed later by signing in and clicking "This is me" on their profile page.
- **User profile page** — clicking your username in the top-right nav opens your personal profile page showing your avatar, display name, sign-up date, and a card for every league you're in. Each league card shows your ranking, ELO rating, W/L record, win%, current streak, form guide, and earned badges. Clicking a league card navigates directly to that league.
- **Multiple leagues** — each league has its own separate data file; switch between leagues from the home page. Signed-in users can create new leagues via the **＋ New** button.
- **Join a league** — signed-in users who aren't yet in a league see a **Join League** banner (inside the league table card) and can join with one click, automatically creating their player entry. If an unclaimed guest with the same display name already exists, the join auto-claims them instead of creating a duplicate.
- **Guest player name collision prevention** — adding a guest whose display name matches a registered user account automatically links the player to that account. If that user is already in the league the request is rejected.
- **ELO rating system** — ratings update automatically after every game
- **League table** — players ranked by current ELO rating, with 👑 crown marking the King of the Hill, **player avatars**, and a **form guide** showing the last 5 results as green/red squares
- **Player profiles** — detailed stats per player including:
  - League name banner identifying which league the profile belongs to
  - Win/loss record & win percentage
  - Current streak, longest win streak, longest loss streak
  - Highest & lowest ELO ever reached
  - Full results history (scrollable)
  - **Biggest Rival** — the opponent they have played most, with head-to-head record
  - **Nemesis** — the opponent who has beaten them most, with loss count and total games
- **Badges & achievements** — players earn badges for milestones:
  - 🥇 First Win · 🎮 Veteran (10 games) · 🏅 Seasoned (50 games) · 💯 Centurion (100 games)
  - 🗡️ Giant Killer (beat the top rated player)
  - 📈 Record Holder (currently hold at least one all-time record — lost if you no longer hold any)
  - 🏆 Grand Slam (hold all six records simultaneously — sole holder, no ties)
  - 👑 King of the Hill (win the first game, or beat the reigning king)
- **King of the Hill** — a special title awarded to the winner of the first ever game; transfers to any player who beats the current holder
- **Records page** — all-time bests for the active league; when players are tied, all names are shown. **Players must have played at least one game to be eligible for any record.**
  - Longest winning streak
  - Longest active winning streak
  - Most games played
  - Most games won
  - Highest ever ELO rating
  - Biggest upset (largest rating deficit overcome by the winner)
  - Defend the Hill (longest consecutive run of wins while holding King of the Hill)
- **Game history** — full log of all recorded results with inline delete confirmation
- **Network accessible** — accessible from any device on the same Wi-Fi

---

## Tech Stack

- **Backend:** Node.js with [Express](https://expressjs.com/), [multer](https://github.com/expressjs/multer) (file uploads), [sharp](https://sharp.pixelplumbing.com/) (image processing), [express-session](https://github.com/expressjs/session) (auth sessions), [bcrypt](https://github.com/kelektiv/node.bcrypt.js) (password hashing)
- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **Data storage:** Append-only JSONL files — one directory per league (`data/<league>/`), plus `data/users.jsonl` for user accounts. Monthly snapshots, in-memory cache, and an `avatars/` directory per league.
- **Testing:** [Playwright](https://playwright.dev/) (end-to-end API & UI tests)
- **Deployment:** [Docker](https://www.docker.com/) + Docker Compose

---

## Getting Started

There are two ways to run the app:

| | Local (development) | Docker (deployment) |
|---|---|---|
| **Requires** | Node.js v18+ | Docker Desktop |
| **Best for** | Developing & debugging | Sharing or running on a server |
| **Start command** | `npm start` | `docker compose up` |
| **Data location** | `./data/` | `./data/` (via volume mount) |

---

### Option 1 — Run locally (development)

#### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher

#### Install dependencies

```bash
npm install
```

#### Start the server

```bash
npm start
```

The server starts on port **3000**. Open your browser at:

- **Local:** [http://localhost:3000](http://localhost:3000)
- **Network:** `http://<your-local-ip>:3000` (printed in the terminal on startup)

---

### Option 2 — Run in Docker

#### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac, Windows, or Linux)

#### First run — build and start

```bash
docker compose up --build
```

This builds the image and starts the container. The app is available at [http://localhost:3000](http://localhost:3000).

#### Subsequent starts

```bash
docker compose up
```

#### Run in the background

```bash
docker compose up -d
```

#### Stop the container

```bash
docker compose down
```

#### View live logs

```bash
docker compose logs -f
```

#### Data persistence

League data is stored in the `./data/` directory on your machine (mounted into the container as a volume). It is **not** stored inside the container — your data survives container restarts, updates, and rebuilds automatically. Back up the `data/` folder regularly to preserve league history.

> **Note:** The Docker image excludes test files and dev dependencies, so `npm test` must be run locally, not inside the container.

---

## Managing Leagues

- A default **Pool** league is created automatically on first run (`data/pool/`)
- Use the **league switcher** in the header to switch between leagues
- Click **＋ New** to create a new league — this creates a new data directory automatically (only visible when signed in)
- The active league is remembered in `localStorage` per browser
- Any page can be deep-linked to a specific league by appending `?league=<slug>` to the URL (e.g. `/?league=chess`, `/records.html?league=backgammon`) — the page will load that league and update `localStorage` accordingly
- **Empty state** — if there are no leagues, the league table and recent games cards are hidden and replaced with a contextual message:
  - **Logged out:** *"There are no leagues at the moment. Register to create your first league."*
  - **Logged in:** *"There are no leagues at the moment. Create your first league."* — the **＋ New** button is highlighted with a pulsing animation

---

## Project Structure

```
pool_league/
├── index.js               # Express server & API routes
├── package.json
├── playwright.config.js   # Playwright test configuration
├── data/
│   ├── users.jsonl        # User accounts (append-only, global)
│   ├── avatars/           # User avatars (<userId>.jpg, shared across leagues)
│   ├── pool/
│   │   ├── players.jsonl  # Pool player registrations (append-only)
│   │   ├── games.jsonl    # Pool game results (append-only)
│   │   ├── avatars/       # Guest player avatars (<playerId>.jpg)
│   │   └── snapshots/     # Monthly derived-state snapshots
│   └── chess/
│       ├── players.jsonl
│       └── games.jsonl
├── tests/
│   ├── helpers.js         # Shared test utilities (incl. registerAndLogin)
│   ├── api.spec.js        # API tests (leagues, players, games, records, badges, auth, claim)
│   ├── home.spec.js       # UI tests — home page
│   ├── player.spec.js     # UI tests — player profile page (incl. claim button)
│   └── records.spec.js    # UI tests — records page
└── public/
    ├── index.html         # Main league table & record game page
    ├── login.html         # Sign-in page
    ├── register.html      # Registration page
    ├── player.html        # Individual player profile page
    ├── user.html          # User profile page (cross-league stats)
    ├── records.html       # All-time records page
    ├── css/
    │   ├── main.css
    │   ├── auth.css       # Login/register page styles
    │   ├── index.css
    │   ├── player.css
    │   ├── user.css       # User profile page styles
    │   └── records.css
    └── js/
        ├── shared.js      # Shared helpers (esc, formatLeagueName, ordinal, fmtDate, formatDate, api)
        ├── auth.js        # Shared auth nav (used by player.html, records.html, user.html)
        ├── index.js       # Frontend logic for main page
        ├── player.js      # Frontend logic for player profile
        ├── user.js        # Frontend logic for user profile
        └── records.js     # Frontend logic for records page
```

---

## Testing

The project has a full [Playwright](https://playwright.dev/) test suite covering both the API and the browser UI. Tests run against an isolated server on port **3001** using a temporary data directory, so they never affect real league data.

### Run all tests

```bash
npm test
```

### Open the interactive Playwright UI

```bash
npm run test:ui
```

### View the HTML report after a run

```bash
npm run test:report
```

### What's covered (198 tests)

| Suite | Tests | Covers |
|-------|-------|--------|
| `api.spec.js` | 112 | Leagues, Players (incl. currentStreak, auto-link on guest add), Games, Delete Game, Profile (incl. rivals, nemeses, tie-breaking), Records (incl. no-games eligibility), ELO maths, King of the Hill, Badges (incl. dynamic Record Holder, upset winner eligibility), Form guide, Biggest Upset, Active Streak, Avatars, Snapshot safety, Auth, Join League & Claim Player (**incl. auto-claim on join, collision prevention**), User-scoped Avatar, **User Profile** |
| `home.spec.js` | 37 | League table (incl. avatar column, streak column), Form guide, Add player, Record game, Game history, Delete game UI, League switcher, No-leagues empty state, Static product name |
| `player.spec.js` | 29 | Hero section (incl. avatar), Stats grid, Badges, Streaks, Results history, Rival & Nemesis cards, Claim Player, 404 |
| `records.spec.js` | 20 | Layout, All 7 record cards, Holder links, Biggest Upset, Active Streak, Empty state |

---

## API Reference

All game/player routes accept a `?league=` query parameter (defaults to `pool`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create a user account `{ name, email, password }` |
| `POST` | `/api/auth/login` | Sign in `{ email, password }` |
| `POST` | `/api/auth/logout` | Sign out (destroys session) |
| `GET` | `/api/auth/me` | Get the currently signed-in user |
| `GET` | `/api/auth/memberships` | Map of `{ leagueSlug: playerId }` for the signed-in user |
| `GET` | `/api/users/:id/profile` | Get a user's profile — avatar, name, sign-up date, and stats for every league they're in |
| `GET` | `/api/users/:id/avatar` | Get a user's avatar (JPEG if uploaded, SVG initials otherwise) |
| `POST` | `/api/users/:id/avatar` | Upload your own avatar (multipart `avatar` field, max 5 MB — own profile only) |
| `GET` | `/api/leagues` | List all leagues |
| `POST` | `/api/leagues` | Create a new league `{ name }` |
| `POST` | `/api/leagues/:league/join` | Signed-in user joins a league (creates their player) |
| `GET` | `/api/players?league=pool` | Get all players sorted by rating |
| `POST` | `/api/players?league=pool` | Add a guest player `{ name }` (no account required) |
| `POST` | `/api/players/:id/claim?league=pool` | Signed-in user claims an unclaimed guest player |
| `GET` | `/api/players/:id/profile?league=pool` | Get full stats for a player |
| `GET` | `/api/games?league=pool` | Get all games (most recent first) |
| `POST` | `/api/games?league=pool` | Record a game result `{ winnerId, loserId }` |
| `DELETE` | `/api/games/:id?league=pool` | Delete a game `{ winnerName }` — requires winner's name as confirmation |
| `GET` | `/api/records?league=pool` | Get all-time records for a league |
| `GET` | `/api/players/:id/avatar?league=pool` | Get player avatar (JPEG if uploaded, SVG initials otherwise) |
| `POST` | `/api/players/:id/avatar?league=pool` | Upload player avatar (multipart `avatar` field, max 5 MB) |
| `POST` | `/api/admin/snapshot?league=pool` | Force a snapshot of the current derived state |

---

## ELO Rating System

The league uses the standard **ELO formula** with a K-factor of **32**.

- Every new player starts at **1000**
- After each game, the winner gains points and the loser loses points
- The amount transferred depends on the rating difference — beating a higher-rated opponent earns more points than beating a lower-rated one
- Equal-rated players exchange exactly **16 points** per game

---

## Data Storage

Each league uses an **append-only log** stored in its own sub-directory under `data/`. User accounts and user-level avatars are stored globally under `data/`.

```
data/
  users.jsonl          ← one user account per line (append-only)
  avatars/
    <userId>.jpg       ← user avatar (shared across all leagues)
  pool/
    players.jsonl      ← one player registration per line (append-only)
    games.jsonl        ← one game result per line (append-only)
    snapshots/
      2026-03-13.json  ← monthly snapshot of derived state
  chess/
    players.jsonl
    games.jsonl
    avatars/
      <playerId>.jpg   ← guest player avatar (no user account)
```

- **Writes are atomic** — each new user, player or game is a single `appendFileSync` call, eliminating read-modify-write race conditions.
- **Ratings are never stored in the log** — game records contain only `{ id, winnerId, loserId, playedAt }`. All derived data (ratings, high/low ELO, biggest upset, beat-top flag) is computed during replay and stored as player-level aggregates in the in-memory cache and snapshots.
- **`ratingChange` is computed at write time** and returned in the POST `/api/games` response for display (e.g. `Richard beat Tom (+16)`) but never persisted.
- **Ratings are never stored** — they are always derived by replaying the game log, so they can never become stale or corrupted.
- **Snapshots** are taken automatically on startup if the latest is ≥ 30 days old. On restart, only games logged *after* the snapshot are replayed, keeping cold-start time bounded.
- **Snapshot safety** — a snapshot is never written for a league with zero players, and a snapshot with an empty player list is ignored on load (falls back to full replay from `players.jsonl`). This prevents a newly-created league from poisoning future cold loads.
- **In-memory cache** — each league's derived state is cached in memory after the first request. Switching between leagues never triggers a re-replay. Cache entries are updated in-place on every write.
- **User avatars** — stored globally at `data/avatars/<userId>.jpg` so a single upload applies across all leagues. Guest players (no account) store their avatar per-league at `data/<league>/avatars/<playerId>.jpg`.
- **Claim events** — when a user claims a guest player, a `{ _claim: true, id, userId }` line is appended to `players.jsonl`. This is replayed on cold load so the link survives restarts.
- **Storage location** is controlled by the `DATA_DIR` environment variable: set automatically by `fly.toml` (Fly.io volume) or `docker-compose.yml` (local volume mount); falls back to `./data` for local development.
- A manual snapshot can be forced via `POST /api/admin/snapshot?league=pool`.
- Back up the entire `data/` folder regularly to preserve league history.

