# 🎱 League Tracker — Development Log

A summary of design and implementation decisions made during the development of the League Tracker application.

---

## Project Origin

The project started as a **Pool league tracker** (`pool_league`) — a simple local web app to track player ELO ratings and game results. It was built with Node.js/Express on the backend and vanilla HTML/CSS/JS on the frontend, with data stored in a JSON file.

---

## Development Decisions

### 1. Project Naming & Configuration
- **Issue:** The project appeared in JetBrains WebStorm as `elorateai` in square brackets beside the project name `pool_league`. This was because the `name` field in `package.json` was set to `elorateai`.
- **Decision:** Updated the `name` field in `package.json` to `pool_league` to match the actual project folder name.

---

### 2. ELO Rating System
- **Decision:** Used the standard **ELO formula** with a **K-factor of 32**.
- Every new player starts at a rating of **1000**.
- After each game, the winner gains points and the loser loses an equal number of points.
- The amount transferred depends on the rating difference — beating a higher-rated opponent earns more points than beating a lower-rated one.
- Equal-rated players exchange exactly **16 points** per game.

#### Longest Winning Streak Calculation
- The streak is calculated by iterating through a player's full game history in chronological order.
- A counter is incremented for each win and reset to zero on any loss.
- The maximum value the counter ever reaches is stored as the longest winning streak.

---

### 3. Source Control — GitHub Setup
- The project was pushed to a new GitHub repository.
- **Issue 1:** The initial push failed because the repository already existed on GitHub.
- **Issue 2:** Authentication failed — GitHub no longer supports password authentication for Git operations over HTTPS.
- **Resolution:** Used a **Personal Access Token (PAT)** in place of a password for HTTPS authentication.

---

### 4. Records Page
- **Decision:** Created a dedicated `records.html` page linked from the home page.
- **Records tracked (initial set):**
  - Longest ever winning streak
  - Longest ever losing streak
  - Most games played
  - Highest ever ELO rating
- Each record displays the name of the player who holds it, with a link to their profile page.
- **Later change:** The **longest losing streak** record was removed as it was deemed undesirable to highlight.
- **Later addition:** A **most games won** record was added.

---

### 5. Multi-Game / Multi-League Support
- **Context:** The question arose — if we wanted to track leagues for multiple games (Chess, Snooker, Pool, Backgammon), how should that be structured?
- **Options considered:**
  - Option 1: Separate apps for each game.
  - Option 2: A single app with a hardcoded game type.
  - **Option 3 (chosen):** A single app that supports multiple leagues, each backed by its own data file, with a UI switcher to move between them.
- **Implementation:**
  - Each league is stored as a separate JSON file in the `data/` directory (e.g. `data/pool.json`, `data/chess.json`).
  - A league switcher UI element was added to the header on all pages.
  - A **＋ New** button allows creating a new league on the fly, which automatically creates a new data file.
  - The active league is persisted per-browser using `localStorage`.
  - All API routes accept a `?league=` query parameter (defaulting to `pool`).
  - Example data files were created for `chess.json`, `darts.json`, `backgammon.json`, and `doh.json`.

---

### 6. Player Profile Page Improvements

#### Results History
- **Initial state:** A "Last 5 Results" card showed results as pills (coloured badges), with one pill rendering larger than the others.
- **Change 1:** Switched from pills to rows so results are displayed as a vertical list for visual consistency.
- **Change 2:** Renamed "Last 5 Results" to **"Results History"** and made the list show **all results** in a scrollable container.

#### Layout — ELO Chart Position
- **Decision:** Moved the **ELO rating chart** above the streaks card on the profile page to give it more visual prominence.

#### Hero Section — Player Name Display
- **Issue:** Long player names were being cut off with ellipses in the hero section.
- **Fix attempt 1:** Changed the layout so the name is always shown in full.
- **Issue persisted:** The name was wrapping onto multiple lines.
- **Final fix:** Forced the name onto a single line (`white-space: nowrap`) and displayed the **ELO rating in smaller text underneath** the name, giving the name full horizontal space.

---

### 7. Badges Feature

A badges/achievements system was designed and implemented to reward player milestones.

#### Badges Defined

| Badge | Criteria |
|-------|----------|
| **First Win** | Win your first game |
| **Veteran** (10 Games Played) | Play 10 games |
| **Seasoned** (50 Games Played) | Play 50 games |
| **Centurion** (100 Games Played) | Play 100 games |
| **Record Holder** | Hold at least one all-time record *(originally named "Record Breaker")* |
| **Grand Slam** | Hold **all five** records simultaneously *(originally named "Legend")* |
| **Giant Killer** | Win a game against the current highest-rated player |
| **King of the Hill** | Win the first ever game or beat the reigning King of the Hill |

#### Badge Naming Changes
- `Record Breaker` → renamed to **Record Holder**
- `Legend` → renamed to **Grand Slam**

#### Grand Slam Icon
- Changed to a **trophy** 🏆 icon.

---

### 8. King of the Hill Feature

- **Concept:** A special status that starts with the winner of the very first game recorded, and transfers to any player who beats the current holder.
- **Display:** A **crown icon** (👑) is shown next to the King of the Hill's name in the league table on the home page.
- **Icon change:** The icon was changed from a custom/emoji icon to a plain **crown** (using a suitable icon/symbol).
- The King of the Hill badge on the profile page also reflects this status.

---

### 9. Playwright Test Suite

- **Decision:** Added a full end-to-end test suite using [Playwright](https://playwright.dev/).
- **Approach:** Tests spin up a separate server instance on **port 3001** using a **temporary data directory** (`/tmp/pool_league_test_data`), completely isolated from real league data.
- The server supports `TEST_PORT` and `TEST_DATA_DIR` environment variables to enable this isolation without any code branching.
- Player and game IDs were changed from `Date.now()` alone to `Date.now() + random suffix` to prevent ID collisions when multiple records are created in quick succession during tests.

#### Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/helpers.js` | — | Shared utilities: `createTestLeague`, `addPlayer`, `recordGame` |
| `tests/api.spec.js` | 56 | All API endpoints — Leagues, Players, Games, Profile, Records, ELO maths, King of the Hill, Badges, Form guide, Biggest Upset, Active Streak |
| `tests/home.spec.js` | 24 | Home page UI — league table, form guide, add player form, record game form, game history, league switcher |
| `tests/player.spec.js` | 20 | Player profile UI — hero section, stats grid, badges, streaks, results history, ELO chart, 404 handling |
| `tests/records.spec.js` | 20 | Records page UI — layout, all 6 record cards, player links, biggest upset, active streak, empty state |

**Total: 120 tests, all passing.**

#### npm scripts added

```bash
npm test            # run all tests headless
npm run test:ui     # open Playwright interactive UI
npm run test:report # view HTML report after a run
```

---

### 10. Records Page — Tied Record Holders

- **Change:** The records API previously tracked only a single holder per record (`playerId` / `playerName`). Updated to return a `holders` array (`[{ id, name }]`) so that all players who share a record value are listed.
- **Backend:** A shared `addHolder()` helper resets the array when a new high value is found, and appends to it on an exact tie.
- **Frontend:** `playerLink()` replaced with `playerLinks()`, which maps the array to comma-separated profile links rendered inside the record card.
- **CSS:** `.record-holder` updated to `flex-wrap` so multiple names wrap neatly; `.holder-sep` styles the comma separators.
- **Tests:** API test suite updated to assert the `holders` array shape and added a test confirming both tied players appear when they share the `mostGamesPlayed` record.

---

### 11. Records Page — Comma Spacing Between Tied Names

- **Issue:** When multiple holders were listed, names were separated by `,` with no space, making them hard to read.
- **Fix:** Changed the separator from `', '` to `',&nbsp;'` (non-breaking space) so names are clearly spaced regardless of how the browser collapses whitespace inside inline HTML.

---

### 12. README Updates

The `README.md` was updated multiple times throughout development to reflect:
- The multi-league architecture
- New pages (records, player profiles)
- Badges and King of the Hill features
- Full API reference
- ELO system explanation
- Data storage approach
- Project structure (including test files)
- Testing section with commands and coverage table
- Tied record holders feature
- Comma spacing between tied names
- Form guide in the league table
- Biggest upset record
- Longest active winning streak record
- Grand Slam badge tie-consistency fix

---

### 13. Form Guide in the League Table

- **Decision:** Added a form guide column to the home page league table showing each player's last 5 results as small coloured squares — green for a win, red for a loss.
- **Backend:** `GET /api/players` now includes a `form` array on each player object — up to 5 entries of `'W'` or `'L'`, taken from the tail of the player's chronological game history.
- **Frontend:** Each table row renders up to 5 `<span class="form-sq form-w/form-l">` elements with a "Win"/"Loss" tooltip. Players with no games show a `—` placeholder. A **Form** column header was added.
- **CSS:** `.form-sq` is a 10×10px rounded square with `2px` margin between squares. `.form-w` uses `var(--green)` and `.form-l` uses `var(--red)`.
- **Tests:** 4 new API tests (form array present, only W/L values, capped at 5, reflects correct results) and 5 new UI tests (column header, squares visible, correct colour classes).

---

### 14. Biggest Upset Record

- **Decision:** Added a record card to the records page — the game where the winner had the largest ELO deficit going in (i.e. `loserRatingBefore - winnerRatingBefore` was greatest).
- **Backend:** The records API scans all games for the largest rating gap and returns a `biggestUpset` object: `{ ratingDiff, winnerId, winnerName, loserId, loserName }`. This has a different shape from the other records (which use a `holders` array) since it is a single game, not a per-player aggregate.
- **Frontend:** A new `upsetHolder()` helper renders "winner beat loser" with both names as profile links, separated by a `<span class="upset-sep">beat</span>` so the word and spacing render correctly inside the flexbox holder div. The value is displayed as `+N pts` in red.
- **CSS:** `.upset-sep` adds `margin: 0 5px` either side of the word "beat". When the card sits alone on the last row of the grid it spans both columns and is centred at max-width 420px.
- **Tests:** 5 new API tests and 4 new UI tests.

---

### 15. Longest Active Winning Streak Record

- **Decision:** Added a `⚡ Longest Active Streak` record card — the player currently on the longest *active* winning streak. This is distinct from the all-time longest streak which may have ended long ago. Positioned immediately after the all-time streak card on the records page.
- **Backend:** After iterating each player's games, the active streak is set to the current `curWin` counter only if the player's most recent game was a win, otherwise 0. Uses the standard `holders` array so tied players are all listed.
- **`computeBadges`:** Updated to include `longestActiveWinStreak` in the records checked for the **Record Holder** and **Grand Slam** badges. The Grand Slam badge description updated from "all four records" to "all five records simultaneously".
- **Frontend:** New card added to `records.js` with the `playerLinks()` helper (same as other streak/stats records).
- **Layout:** With 6 cards total the 2×3 grid is even — no orphan card CSS needed.
- **Tests:** 4 new API tests (field present, correct holder when on active streak, zeroed when last game was a loss, tied when both players have matching streaks) and 3 new UI tests (card visible, Alice shown as holder, empty state `—`). Total: 118 tests.

---

### 16. Grand Slam Badge — Tie-Consistency Bug Fix

- **Bug:** `computeBadges` tracked a single `playerId` per record using a plain object and strict `>` comparison. This meant:
  - The **first** player to reach a tied value was stored as the holder and kept
  - The **second** player who matched that value never overwrote it
  - The first player could therefore earn Grand Slam even with a tied record
  - The second player could never earn Grand Slam for the same tied record
  - Behaviour was inconsistent depending purely on iteration order through the players array
- **Fix:** Replaced the `holders` plain-object with `recHolders` — a `Set` of player IDs per record, using the same pattern as the records API endpoint:
  - A new high resets the set to just that player
  - A tie appends to the set
  - **`achieve_record` (Record Holder):** player appears in *any* record's set — ties still qualify ✓
  - **`all_records` (Grand Slam):** player is the **sole** holder (`set.size === 1`) of **every** record — ties disqualify ✗
- **Tests:** 2 new badge tests — Grand Slam NOT awarded when any record is tied; Record Holder IS awarded when a record is tied. Total: 120 tests.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Data storage | JSON files (one per league, in `data/`) |
| Charts | Chart.js (ELO history chart on profile page) |
| Testing | Playwright (API + UI, 120 tests) |
| Version control | Git + GitHub |

---

## File Structure

```
pool_league/
├── index.js               # Express server & all API routes
├── package.json
├── playwright.config.js   # Playwright configuration (port 3001, isolated data dir)
├── README.md
├── DEVELOPMENT_LOG.md     # This file
├── data/
│   ├── pool.json          # Pool league data
│   ├── chess.json         # Chess league data
│   ├── darts.json         # Darts league data
│   ├── backgammon.json    # Backgammon league data
│   └── doh.json           # Example/test league
├── tests/
│   ├── helpers.js         # Shared test utilities
│   ├── api.spec.js        # API tests
│   ├── home.spec.js       # Home page UI tests
│   ├── player.spec.js     # Player profile UI tests
│   └── records.spec.js    # Records page UI tests
└── public/
    ├── index.html         # League table, record game, league switcher
    ├── player.html        # Individual player profile
    ├── records.html       # All-time records page
    ├── css/
    │   ├── main.css       # Shared styles
    │   ├── index.css
    │   ├── player.css
    │   └── records.css
    └── js/
        ├── index.js       # Home page logic
        ├── player.js      # Profile page logic
        └── records.js     # Records page logic
```

---

## API Reference

All routes accept a `?league=` query parameter (defaults to `pool`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/leagues` | List all leagues |
| `POST` | `/api/leagues` | Create a new league `{ name }` |
| `GET` | `/api/players?league=pool` | Get all players sorted by ELO |
| `POST` | `/api/players?league=pool` | Add a new player `{ name }` |
| `GET` | `/api/players/:id/profile?league=pool` | Get full stats for a player |
| `GET` | `/api/games?league=pool` | Get all games (most recent first) |
| `POST` | `/api/games?league=pool` | Record a game result `{ winnerId, loserId }` |
| `GET` | `/api/records?league=pool` | Get all-time records |

