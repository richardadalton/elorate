const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// ── Persistence ──────────────────────────────────────────────────────────────

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial = { players: [], games: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

// ── ELO calculation ───────────────────────────────────────────────────────────

const K = 32;

function calcElo(winnerRating, loserRating) {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser  = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));
  const change = Math.round(K * (1 - expectedWinner));
  return {
    newWinnerRating: winnerRating + change,
    newLoserRating:  loserRating  + Math.round(K * (0 - expectedLoser)),
    change
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/players — league table sorted by rating desc
app.get('/api/players', (req, res) => {
  const sorted = [...db.players].sort((a, b) => b.rating - a.rating);
  res.json(sorted);
});

// POST /api/players — add player
app.post('/api/players', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const duplicate = db.players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
  if (duplicate) return res.status(400).json({ error: 'Player already exists' });

  const player = {
    id: Date.now().toString(),
    name: name.trim(),
    rating: 1000,
    wins: 0,
    losses: 0
  };
  db.players.push(player);
  saveDb(db);
  res.status(201).json(player);
});


// GET /api/players/:id/profile — full stats for one player
app.get('/api/players/:id/profile', (req, res) => {
  const player = db.players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // All games involving this player, chronological
  const games = db.games.filter(g => g.winnerId === player.id || g.loserId === player.id);

  // League position
  const sorted = [...db.players].sort((a, b) => b.rating - a.rating);
  const position = sorted.findIndex(p => p.id === player.id) + 1;

  // Last 5 results
  const last5 = games.slice(-5).reverse().map(g => ({
    result: g.winnerId === player.id ? 'W' : 'L',
    opponent: g.winnerId === player.id
      ? (db.players.find(p => p.id === g.loserId)  || { name: 'Unknown' }).name
      : (db.players.find(p => p.id === g.winnerId) || { name: 'Unknown' }).name,
    ratingChange: g.winnerId === player.id ? +g.ratingChange : -g.ratingChange,
    playedAt: g.playedAt
  }));

  // Streaks
  let longestWin = 0, longestLoss = 0;
  let curWin = 0, curLoss = 0;
  let currentStreak = { type: null, count: 0 };

  games.forEach(g => {
    const won = g.winnerId === player.id;
    if (won) {
      curWin++;
      curLoss = 0;
      if (curWin > longestWin) longestWin = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > longestLoss) longestLoss = curLoss;
    }
  });

  if (games.length) {
    const lastWon = games[games.length - 1].winnerId === player.id;
    if (lastWon) currentStreak = { type: 'W', count: curWin };
    else         currentStreak = { type: 'L', count: curLoss };
  }

  // Highest / lowest ELO ever (reconstruct from game history)
  let high = player.rating, low = player.rating;
  // Walk through games chronologically, tracking rating
  let rating = 1000; // started at 1000
  games.forEach(g => {
    const won = g.winnerId === player.id;
    rating = won ? g.winnerRatingAfter : g.loserRatingAfter;
    if (rating > high) high = rating;
    if (rating < low)  low  = rating;
  });
  // Also check the starting rating of 1000
  if (1000 > high) high = 1000;
  if (1000 < low)  low  = 1000;

  // ELO history for chart — starting point + one entry per game
  const eloHistory = [{ rating: 1000, playedAt: null, label: 'Start' }];
  games.forEach(g => {
    const won = g.winnerId === player.id;
    eloHistory.push({
      rating: won ? g.winnerRatingAfter : g.loserRatingAfter,
      playedAt: g.playedAt
    });
  });

  const total = player.wins + player.losses;

  res.json({
    id: player.id,
    name: player.name,
    rating: player.rating,
    position,
    totalPlayers: db.players.length,
    wins: player.wins,
    losses: player.losses,
    played: total,
    winPct: total ? Math.round((player.wins / total) * 100) : 0,
    last5,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    currentStreak,
    highestRating: high,
    lowestRating: low,
    eloHistory
  });
});

// GET /api/games — game history, most recent first
app.get('/api/games', (req, res) => {
  const games = [...db.games].reverse();
  // Enrich with player names
  const enriched = games.map(g => {
    const winner = db.players.find(p => p.id === g.winnerId);
    const loser  = db.players.find(p => p.id === g.loserId);
    return {
      ...g,
      winnerName: winner ? winner.name : 'Unknown',
      loserName:  loser  ? loser.name  : 'Unknown'
    };
  });
  res.json(enriched);
});

// POST /api/games — record a result
app.post('/api/games', (req, res) => {
  const { winnerId, loserId } = req.body;
  if (!winnerId || !loserId) return res.status(400).json({ error: 'winnerId and loserId required' });
  if (winnerId === loserId) return res.status(400).json({ error: 'Winner and loser must be different players' });

  const winner = db.players.find(p => p.id === winnerId);
  const loser  = db.players.find(p => p.id === loserId);
  if (!winner) return res.status(404).json({ error: 'Winner not found' });
  if (!loser)  return res.status(404).json({ error: 'Loser not found' });

  const { newWinnerRating, newLoserRating, change } = calcElo(winner.rating, loser.rating);

  const game = {
    id: Date.now().toString(),
    winnerId: winner.id,
    loserId:  loser.id,
    winnerRatingBefore: winner.rating,
    loserRatingBefore:  loser.rating,
    winnerRatingAfter:  newWinnerRating,
    loserRatingAfter:   newLoserRating,
    ratingChange: change,
    playedAt: new Date().toISOString()
  };

  winner.rating = newWinnerRating;
  winner.wins  += 1;
  loser.rating  = newLoserRating;
  loser.losses += 1;

  db.games.push(game);
  saveDb(db);

  res.status(201).json({
    ...game,
    winnerName: winner.name,
    loserName:  loser.name
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const os = require('os');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`Pool League running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
});

