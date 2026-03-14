const express  = require('express');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const multer    = require('multer');
const sharp     = require('sharp');
const session   = require('express-session');
const bcrypt    = require('bcrypt');

const app  = express();
const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT) : 3000;
const DATA_DIR = process.env.TEST_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data');

// ── Constants ─────────────────────────────────────────────────────────────────

const INITIAL_RATING    = 1000; // ELO rating assigned to every new player
const AVATAR_MAX_BYTES  = 5 * 1024 * 1024; // 5 MB upload limit
const AVATAR_CACHE_SECS = 86400;            // 24 h browser cache for uploaded avatars
const SNAPSHOT_DAYS     = 30;               // auto-snapshot cadence
const BCRYPT_ROUNDS     = 10;               // bcrypt cost factor

// ── User storage ──────────────────────────────────────────────────────────────
// Users are global (not per-league): data/users.jsonl
// Each line: { id, name, email, passwordHash, createdAt }

function usersPath() {
  return path.join(DATA_DIR, 'users.jsonl');
}

function ensureUsersFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(usersPath())) fs.writeFileSync(usersPath(), '');
}

function readUsers() {
  ensureUsersFile();
  const text = fs.readFileSync(usersPath(), 'utf8');
  return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

function appendUser(user) {
  ensureUsersFile();
  fs.appendFileSync(usersPath(), JSON.stringify(user) + '\n');
}

// ── Append-only persistence ───────────────────────────────────────────────────
//
// Layout on disk (one sub-directory per league):
//   data/<league>/players.jsonl    — one JSON object per line, append-only
//   data/<league>/games.jsonl      — one JSON object per line, append-only
//   data/<league>/snapshots/       — periodic snapshots of derived state
//     <ISO-date>.json              — { snapshotAt, players: [{id,name,registeredAt,rating,wins,losses}] }
//
// In memory (leagueCache Map):
//   { players, games }             — fully derived state, invalidated only on
//                                    app restart; updated in-place on writes.

function leagueDir(league) {
  return path.join(DATA_DIR, league);
}
function playersPath(league) {
  return path.join(leagueDir(league), 'players.jsonl');
}
function gamesPath(league) {
  return path.join(leagueDir(league), 'games.jsonl');
}
function snapshotsDir(league) {
  return path.join(leagueDir(league), 'snapshots');
}

function ensureLeagueDir(league) {
  const dir = leagueDir(league);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sd = snapshotsDir(league);
  if (!fs.existsSync(sd)) fs.mkdirSync(sd, { recursive: true });
  if (!fs.existsSync(playersPath(league))) fs.writeFileSync(playersPath(league), '');
  if (!fs.existsSync(gamesPath(league)))   fs.writeFileSync(gamesPath(league),   '');
}

function avatarsDir(league) {
  return path.join(leagueDir(league), 'avatars');
}
function avatarPath(league, playerId) {
  return path.join(avatarsDir(league), `${playerId}.jpg`);
}

// Global user avatars — stored at data/avatars/<userId>.jpg (not per-league)
function userAvatarsDir() {
  return path.join(DATA_DIR, 'avatars');
}
function userAvatarPath(userId) {
  return path.join(userAvatarsDir(), `${userId}.jpg`);
}

/** Return the avatar file path for a player — user-level if linked, else player-level. */
function resolveAvatarPath(player, league) {
  if (player && player.userId) return userAvatarPath(player.userId);
  return avatarPath(league, player ? player.id : '');
}

/** Look up a player's name by id, falling back to 'Unknown'. */
function playerName(players, id) {
  return (players.find(p => p.id === id) || { name: 'Unknown' }).name;
}

/** Read all JSON lines from a file, skipping blank lines. */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));

  // Apply tombstones: collect deleted game ids, then filter them out
  const deleted = new Set(
    lines.filter(l => l._tombstone).map(l => l.gameId)
  );

  // Apply claims: build a map of playerId → userId from _claim events
  const claims = {};
  lines.filter(l => l._claim).forEach(l => { claims[l.id] = l.userId; });

  return lines
    .filter(l => !l._tombstone && !l._claim && !deleted.has(l.id))
    .map(l => {
      if (claims[l.id]) return { ...l, userId: claims[l.id] };
      return l;
    });
}

/** Append a single object as a JSON line. */
function appendJsonl(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

/** Return the most recent snapshot, or null. */
function loadLatestSnapshot(league) {
  const dir = snapshotsDir(league);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort(); // ISO date filenames sort chronologically
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

/** Write a snapshot of the current fully-derived player state. */
function writeSnapshot(league, players) {
  ensureLeagueDir(league);
  const snapshotAt = new Date().toISOString();
  const filename   = snapshotAt.slice(0, 10) + '.json'; // one per day max
  fs.writeFileSync(path.join(snapshotsDir(league), filename), JSON.stringify({ snapshotAt, players }, null, 2));
}

/** Days elapsed since an ISO date string. */
function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/** Delete all snapshot files for a league (called before a cold-reload after game deletion). */
function clearSnapshots(league) {
  const dir = snapshotsDir(league);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
  }
}


function maybeAutoSnapshot(league, players) {
  if (players.length === 0) return;   // never snapshot an empty league
  const snap = loadLatestSnapshot(league);
  if (!snap || daysSince(snap.snapshotAt) >= SNAPSHOT_DAYS) writeSnapshot(league, players);
}

// ── ELO ───────────────────────────────────────────────────────────────────────

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

// ── Shared per-player stats helper ───────────────────────────────────────────
//
// Computes all per-player derived values that require iterating playerGames:
//   streaks, highest/lowest ELO, ELO history.
// Called by the league-table route, the profile route, and computeRecordMaps
// so the logic lives in exactly one place.
//
// Returns:
//   { longestWinStreak, longestLossStreak, currentStreak,
//     highestRating, lowestRating, activeWinStreak, eloHistory }

function computePlayerGameStats(playerId, playerGames, startingRating = INITIAL_RATING) {
  let longestWin = 0, longestLoss = 0, curWin = 0, curLoss = 0;
  let high = 0, low = Infinity;
  const eloHistory = [{ rating: startingRating, playedAt: null, label: 'Start' }];

  for (const g of playerGames) {
    const won = g.winnerId === playerId;
    const ratingAfter = won ? g.winnerRatingAfter : g.loserRatingAfter;

    if (won) { curWin++; curLoss = 0; if (curWin  > longestWin)  longestWin  = curWin; }
    else     { curLoss++; curWin = 0; if (curLoss > longestLoss) longestLoss = curLoss; }

    if (ratingAfter > high) high = ratingAfter;
    if (ratingAfter < low)  low  = ratingAfter;

    eloHistory.push({ rating: ratingAfter, playedAt: g.playedAt });
  }

  // If no games were played, high/low fall back to starting rating
  if (playerGames.length === 0) { high = startingRating; low = startingRating; }

  // Clamp so the start rating (1000) is always included in the range
  if (startingRating > high) high = startingRating;
  if (startingRating < low)  low  = startingRating;

  const currentStreak = playerGames.length === 0
    ? { type: null, count: 0 }
    : playerGames[playerGames.length - 1].winnerId === playerId
      ? { type: 'W', count: curWin }
      : { type: 'L', count: curLoss };

  // activeWinStreak: curWin only if the last game was a win, else 0
  const activeWinStreak = currentStreak.type === 'W' ? curWin : 0;

  return { longestWinStreak: longestWin, longestLossStreak: longestLoss,
           currentStreak, highestRating: high, lowestRating: low,
           activeWinStreak, eloHistory };
}



/**
 * Given a base player list (from snapshot or raw registrations) and a list of
 * games to replay, return the fully-derived player state.
 */
function replayGames(basePlayers, games) {
  const state = new Map();
  for (const p of basePlayers) {
    state.set(p.id, {
      id:           p.id,
      name:         p.name,
      userId:       p.userId || null,
      registeredAt: p.registeredAt,
      rating:       typeof p.rating  === 'number' ? p.rating  : INITIAL_RATING,
      wins:         typeof p.wins    === 'number' ? p.wins    : 0,
      losses:       typeof p.losses  === 'number' ? p.losses  : 0,
    });
  }
  for (const g of games) {
    const w = state.get(g.winnerId);
    const l = state.get(g.loserId);
    if (!w || !l) continue; // orphaned game — skip
    const { newWinnerRating, newLoserRating } = calcElo(w.rating, l.rating);
    w.rating = newWinnerRating; w.wins++;
    l.rating = newLoserRating;  l.losses++;
  }
  return [...state.values()];
}

// ── Per-league in-memory cache ────────────────────────────────────────────────
//
// leagueCache: Map<slug, { players: Player[], games: Game[] }>
//
// • Populated lazily on first request (cold load = snapshot + replay)
// • Updated in-place on every write — no re-replay needed
// • Cleared on app restart

const leagueCache = new Map();

/**
 * Cold-load: find latest snapshot, load only games after its timestamp,
 * replay them, cache the result, and auto-snapshot if due.
 */
function coldLoad(league) {
  ensureLeagueDir(league);

  const snap     = loadLatestSnapshot(league);
  const allGames = readJsonl(gamesPath(league));

  let basePlayers, replaySubset;

  if (snap && snap.players && snap.players.length > 0) {
    basePlayers  = snap.players;
    replaySubset = allGames.filter(g => g.playedAt > snap.snapshotAt);
  } else {
    const rawPlayers = readJsonl(playersPath(league));
    basePlayers      = rawPlayers.map(p => ({ ...p, rating: INITIAL_RATING, wins: 0, losses: 0 }));
    replaySubset     = allGames;
  }

  const players = replayGames(basePlayers, replaySubset);
  maybeAutoSnapshot(league, players);

  const entry = { players, games: allGames };
  leagueCache.set(league, entry);
  return entry;
}

/** Get the cached state for a league, loading it if necessary. */
function getCache(league) {
  if (!leagueCache.has(league)) coldLoad(league);
  return leagueCache.get(league);
}

// ── League helpers ────────────────────────────────────────────────────────────

function getLeagues() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => {
      const full = path.join(DATA_DIR, f);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'games.jsonl'));
    });
}

function validLeague(league) {
  return typeof league === 'string' && /^[a-z0-9_-]+$/i.test(league) && league.length <= 40;
}

function leagueExists(league) {
  return fs.existsSync(path.join(leagueDir(league), 'games.jsonl'));
}

// ── Badges ────────────────────────────────────────────────────────────────────

const BADGE_DEFS = [
  { id: 'first_win',        name: 'First Win',        icon: '🥇', desc: 'Win your first game' },
  { id: 'games_10',         name: 'Veteran',           icon: '🎮', desc: 'Play 10 games' },
  { id: 'games_50',         name: 'Seasoned',          icon: '🏅', desc: 'Play 50 games' },
  { id: 'games_100',        name: 'Centurion',         icon: '💯', desc: 'Play 100 games' },
  { id: 'beat_top',         name: 'Giant Killer',      icon: '🗡️', desc: 'Beat the top rated player' },
  { id: 'achieve_record',   name: 'Record Holder',     icon: '📈', desc: 'Hold at least one all-time record' },
  { id: 'all_records',      name: 'Grand Slam',        icon: '🏆', desc: 'Hold all six records simultaneously (sole holder, no ties)' },
  { id: 'king_of_the_hill', name: 'King of the Hill',  icon: '👑', desc: 'Win the first ever game or beat the reigning King of the Hill' }
];

// Walk the game history chronologically — the winner of the first game
// becomes king; the title transfers whenever the current king loses.
// Games are stored in append order (chronological) so no sort is needed.
function computeKingOfTheHill(games) {
  if (!games.length) return null;
  let kingId = games[0].winnerId;
  for (let i = 1; i < games.length; i++) {
    if (games[i].loserId === kingId) kingId = games[i].winnerId;
  }
  return kingId;
}

function computeRecordMaps(players, games) {
  const recVals = {
    longestWinStreak: 0, mostGamesPlayed: 0, mostGamesWon: 0,
    highestEloRating: 0, longestActiveWinStreak: 0, defendTheHill: 0,
  };
  const recHolders = {
    longestWinStreak: new Set(), mostGamesPlayed: new Set(), mostGamesWon: new Set(),
    highestEloRating: new Set(), longestActiveWinStreak: new Set(), defendTheHill: new Set(),
  };

  function track(key, value, pid) {
    if (value > recVals[key])                     { recVals[key] = value; recHolders[key] = new Set([pid]); }
    else if (value === recVals[key] && value > 0) { recHolders[key].add(pid); }
  }

  for (const p of players) {
    const pg = games.filter(g => g.winnerId === p.id || g.loserId === p.id);
    if (pg.length === 0) continue;   // must have played at least one game to hold a record

    track('mostGamesPlayed', p.wins + p.losses, p.id);
    track('mostGamesWon',    p.wins,             p.id);

    const stats = computePlayerGameStats(p.id, pg);
    track('highestEloRating',       stats.highestRating,   p.id);
    track('longestWinStreak',       stats.longestWinStreak, p.id);
    track('longestActiveWinStreak', stats.activeWinStreak,  p.id);
  }

  // Defend the Hill — games are already in chronological order in the cache
  {
    const defendBest = {};
    if (games.length) {
      let kingId = games[0].winnerId;
      let curDefend = 1;
      defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
      for (let i = 1; i < games.length; i++) {
        const g = games[i];
        if (g.winnerId === kingId) {
          curDefend++;
          defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
        } else {
          kingId    = g.winnerId;
          curDefend = 1;
          defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
        }
      }
    }
    for (const p of players) track('defendTheHill', defendBest[p.id] || 0, p.id);
  }

  return { recVals, recHolders };
}

// Return the player ID who holds the current biggest upset, or null if none.
function computeBiggestUpsetHolder(games) {
  let best = 0, holderId = null;
  for (const g of games) {
    const diff = g.loserRatingBefore - g.winnerRatingBefore;
    if (diff > best) { best = diff; holderId = g.winnerId; }
  }
  return holderId;
}

// recHolders is passed in from the caller (already computed by computeRecordMaps)
// so we avoid computing it twice on every profile request.
function computeBadges(player, playerGames, allPlayers, allGames, recHolders) {
  const earned = new Set();
  const played = player.wins + player.losses;

  if (player.wins >= 1)   earned.add('first_win');
  if (played >= 10)       earned.add('games_10');
  if (played >= 50)       earned.add('games_50');
  if (played >= 100)      earned.add('games_100');

  // Beat the top-rated player — O(n) single forward pass.
  // Build a running map of every player's rating as of each game,
  // then check if the loser was the top-rated player at that moment.
  {
    const runningRatings = {};  // playerId → rating just before this game
    allPlayers.forEach(p => { runningRatings[p.id] = INITIAL_RATING; });

    for (const g of allGames) {
      // snapshot ratings *before* this game is applied
      const topRating = Math.max(...Object.values(runningRatings));
      if (g.winnerId === player.id && runningRatings[g.loserId] >= topRating) {
        earned.add('beat_top');
      }
      // advance running state
      runningRatings[g.winnerId] = g.winnerRatingAfter;
      runningRatings[g.loserId]  = g.loserRatingAfter;
    }
  }

  const holdsAny = Object.values(recHolders).some(s => s.has(player.id))
                || computeBiggestUpsetHolder(allGames) === player.id;
  const holdsAll = Object.values(recHolders).every(s => s.size === 1 && s.has(player.id));
  if (holdsAny) earned.add('achieve_record');
  if (holdsAll) earned.add('all_records');

  if (computeKingOfTheHill(allGames) === player.id) earned.add('king_of_the_hill');

  return BADGE_DEFS.map(b => ({ ...b, earned: earned.has(b.id) }));
}

// ── Profile route helpers ─────────────────────────────────────────────────────

/** Build the results history array (most-recent first) for a player's profile. */
function computeProfileResults(player, playerGames, players) {
  return [...playerGames].reverse().map(g => ({
    result:       g.winnerId === player.id ? 'W' : 'L',
    opponent:     playerName(players, g.winnerId === player.id ? g.loserId : g.winnerId),
    ratingChange: g.winnerId === player.id ? +g.ratingChange : -g.ratingChange,
    playedAt:     g.playedAt,
  }));
}

/**
 * Build head-to-head stats against every opponent, then derive rivals and nemeses.
 * Returns { rivals, nemeses }.
 *
 * Rival   = opponent(s) most played against; ties → show all.
 * Nemesis = opponent(s) who beat this player most; tie-break by fewest total games.
 */
function computeH2H(player, playerGames, players) {
  const h2h = {};
  for (const g of playerGames) {
    const oppId = g.winnerId === player.id ? g.loserId : g.winnerId;
    if (!h2h[oppId]) h2h[oppId] = { id: oppId, name: playerName(players, oppId), played: 0, wins: 0, losses: 0 };
    h2h[oppId].played++;
    if (g.winnerId === player.id) h2h[oppId].wins++;
    else                          h2h[oppId].losses++;
  }
  const opponents = Object.values(h2h);

  let rivals = [];
  if (opponents.length) {
    const maxPlayed = Math.max(...opponents.map(o => o.played));
    rivals = opponents.filter(o => o.played === maxPlayed);
  }

  let nemeses = [];
  if (opponents.length) {
    const maxLosses = Math.max(...opponents.map(o => o.losses));
    if (maxLosses > 0) {
      const mostBeaten = opponents.filter(o => o.losses === maxLosses);
      const minPlayed  = Math.min(...mostBeaten.map(o => o.played));
      nemeses = mostBeaten.filter(o => o.played === minPlayed);
    }
  }

  return { rivals, nemeses };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'pool_league_dev_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth routes ───────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !name.trim())     return res.status(400).json({ error: 'Name is required' });
  if (!email || !email.trim())   return res.status(400).json({ error: 'Email is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const normEmail = email.trim().toLowerCase();
  const users = readUsers();
  if (users.find(u => u.email === normEmail)) {
    return res.status(400).json({ error: 'An account with that email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = {
    id:           `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name:         name.trim(),
    email:        normEmail,
    passwordHash,
    createdAt:    new Date().toISOString(),
  };
  appendUser(user);

  req.session.userId = user.id;
  res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const users = readUsers();
  const user  = users.find(u => u.email === email.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email });
});

// GET /api/auth/memberships — map of league slug → playerId for the logged-in user
app.get('/api/auth/memberships', (req, res) => {
  if (!req.session.userId) return res.json({});
  const memberships = {};
  for (const league of getLeagues()) {
    const { players } = getCache(league);
    const player = players.find(p => p.userId === req.session.userId);
    if (player) memberships[league] = player.id;
  }
  res.json(memberships);
});

// ── League routes ─────────────────────────────────────────────────────────────

app.get('/api/leagues', (_req, res) => {
  res.json(getLeagues());
});

app.post('/api/leagues', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (!validLeague(slug)) return res.status(400).json({ error: 'Invalid league name' });
  if (leagueExists(slug)) return res.status(400).json({ error: 'League already exists' });
  ensureLeagueDir(slug);
  res.status(201).json({ league: slug });
});

// ── Helper: resolve & validate ?league= param ─────────────────────────────────

function resolveLeague(req, res) {
  const league = (req.query.league || 'pool').toLowerCase();
  if (!validLeague(league))  { res.status(400).json({ error: 'Invalid league' });    return null; }
  if (!leagueExists(league)) { res.status(404).json({ error: 'League not found' }); return null; }
  return league;
}

// ── Admin: manual snapshot ────────────────────────────────────────────────────

app.post('/api/admin/snapshot', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players } = getCache(league);
  writeSnapshot(league, players);
  res.json({ ok: true, snapshotAt: new Date().toISOString(), players: players.length });
});

// ── Players ───────────────────────────────────────────────────────────────────

app.get('/api/players', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const kingId = computeKingOfTheHill(games);

  const result = sorted.map(p => {
    const playerGames = games.filter(g => g.winnerId === p.id || g.loserId === p.id);

    const form = playerGames.slice(-5).map(g => g.winnerId === p.id ? 'W' : 'L');

    const { currentStreak } = computePlayerGameStats(p.id, playerGames);

    return { ...p, form, currentStreak };
  });

  res.json({ players: result, kingId });
});

// POST /api/leagues/:league/join — logged-in user joins a league (creates their player)
app.post('/api/leagues/:league/join', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const league = req.params.league.toLowerCase();
  if (!validLeague(league))  return res.status(400).json({ error: 'Invalid league' });
  if (!leagueExists(league)) return res.status(404).json({ error: 'League not found' });

  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { players } = getCache(league);

  // Already a member?
  if (players.find(p => p.userId === user.id)) {
    return res.status(400).json({ error: 'You are already in this league' });
  }

  const player = {
    id:           `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name:         user.name,
    userId:       user.id,
    registeredAt: new Date().toISOString(),
    rating:       INITIAL_RATING,
    wins:         0,
    losses:       0,
  };

  appendJsonl(playersPath(league), { id: player.id, name: player.name, userId: player.userId, registeredAt: player.registeredAt });
  players.push(player);

  res.status(201).json(player);
});

// POST /api/players/:id/claim — logged-in user claims an unclaimed guest player
app.post('/api/players/:id/claim', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const league = resolveLeague(req, res);
  if (!league) return;

  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { players } = getCache(league);

  // User must not already be a player in this league
  if (players.find(p => p.userId === user.id)) {
    return res.status(400).json({ error: 'You already have a player in this league' });
  }

  const player = players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Player must be unclaimed
  if (player.userId) return res.status(400).json({ error: 'Player is already claimed' });

  // Link the player to this user by appending a claim event
  appendJsonl(playersPath(league), {
    _claim: true, id: player.id, userId: user.id, claimedAt: new Date().toISOString(),
  });

  // Update cache in-place
  player.userId = user.id;

  res.json({ ok: true, playerId: player.id, userId: user.id });
});

app.post('/api/players', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const { players } = getCache(league);
  const duplicate = players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
  if (duplicate) return res.status(400).json({ error: 'Player already exists' });

  const player = {
    id:           `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name:         name.trim(),
    userId:       null,
    registeredAt: new Date().toISOString(),
    rating:       INITIAL_RATING,
    wins:         0,
    losses:       0,
  };

  appendJsonl(playersPath(league), { id: player.id, name: player.name, userId: player.userId, registeredAt: player.registeredAt });
  players.push(player);

  res.status(201).json(player);
});

// ── Player profile ────────────────────────────────────────────────────────────

app.get('/api/players/:id/profile', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);

  const player = players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const playerGames = games.filter(g => g.winnerId === player.id || g.loserId === player.id);
  const position    = [...players].sort((a, b) => b.rating - a.rating).findIndex(p => p.id === player.id) + 1;
  const total       = player.wins + player.losses;

  const stats   = computePlayerGameStats(player.id, playerGames);
  const results = computeProfileResults(player, playerGames, players);
  const { rivals, nemeses } = computeH2H(player, playerGames, players);
  const { recHolders } = computeRecordMaps(players, games);

  // claimable: true if player has no userId AND the requesting user is logged in
  // AND the requesting user doesn't already have a player in this league
  const requestingUserId = req.session.userId || null;
  const userAlreadyInLeague = requestingUserId
    ? players.some(p => p.userId === requestingUserId && p.id !== player.id)
    : false;
  const claimable = !player.userId && !!requestingUserId && !userAlreadyInLeague;

  res.json({
    id: player.id, name: player.name, rating: player.rating,
    position, totalPlayers: players.length,
    wins: player.wins, losses: player.losses, played: total,
    winPct: total ? Math.round((player.wins / total) * 100) : 0,
    claimable,
    results,
    longestWinStreak:  stats.longestWinStreak,
    longestLossStreak: stats.longestLossStreak,
    currentStreak:     stats.currentStreak,
    highestRating:     stats.highestRating,
    lowestRating:      stats.lowestRating,
    eloHistory:        stats.eloHistory,
    badges: computeBadges(player, playerGames, players, games, recHolders),
    rivals, nemeses,
  });
});

// ── Records ───────────────────────────────────────────────────────────────────

app.get('/api/records', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);

  const records = {
    longestWinStreak:       { value: 0, holders: [] },
    longestActiveWinStreak: { value: 0, holders: [] },
    mostGamesPlayed:        { value: 0, holders: [] },
    mostGamesWon:           { value: 0, holders: [] },
    highestEloRating:       { value: 0, holders: [] },
    defendTheHill:          { value: 0, holders: [] },
    biggestUpset: { ratingDiff: 0, winnerId: null, winnerName: null, loserId: null, loserName: null },
  };

  function addHolder(record, value, player) {
    if (value > record.value) {
      record.value   = value;
      record.holders = [{ id: player.id, name: player.name }];
    } else if (value === record.value && value > 0) {
      record.holders.push({ id: player.id, name: player.name });
    }
  }

  for (const player of players) {
    const pg = games.filter(g => g.winnerId === player.id || g.loserId === player.id);
    if (pg.length === 0) continue;   // must have played at least one game to hold a record

    addHolder(records.mostGamesPlayed, player.wins + player.losses, player);
    addHolder(records.mostGamesWon,    player.wins,                 player);

    const stats = computePlayerGameStats(player.id, pg);
    addHolder(records.highestEloRating,       stats.highestRating,    player);
    addHolder(records.longestWinStreak,       stats.longestWinStreak,  player);
    addHolder(records.longestActiveWinStreak, stats.activeWinStreak,   player);
  }

  // Defend the Hill
  {
    const sorted = [...games].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    const defendBest = {};
    if (sorted.length) {
      let kingId = sorted[0].winnerId;
      let curDefend = 1;
      defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
      for (let i = 1; i < sorted.length; i++) {
        const g = sorted[i];
        if (g.winnerId === kingId) {
          curDefend++;
          defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
        } else {
          kingId    = g.winnerId;
          curDefend = 1;
          defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
        }
      }
    }
    for (const player of players) addHolder(records.defendTheHill, defendBest[player.id] || 0, player);
  }

  // Biggest upset
  for (const g of games) {
    const diff = g.loserRatingBefore - g.winnerRatingBefore;
    if (diff > records.biggestUpset.ratingDiff) {
      records.biggestUpset = {
        ratingDiff: diff,
        winnerId:   g.winnerId,
        winnerName: playerName(players, g.winnerId),
        loserId:    g.loserId,
        loserName:  playerName(players, g.loserId),
      };
    }
  }

  res.json(records);
});

// ── Games ─────────────────────────────────────────────────────────────────────

app.get('/api/games', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);
  const enriched = [...games].reverse().map(g => ({
    ...g,
    winnerName: playerName(players, g.winnerId),
    loserName:  playerName(players, g.loserId),
  }));
  res.json(enriched);
});

app.post('/api/games', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { winnerId, loserId } = req.body;
  if (!winnerId || !loserId)  return res.status(400).json({ error: 'winnerId and loserId required' });
  if (winnerId === loserId)   return res.status(400).json({ error: 'Winner and loser must be different players' });

  const { players, games } = getCache(league);

  const winner = players.find(p => p.id === winnerId);
  const loser  = players.find(p => p.id === loserId);
  if (!winner) return res.status(404).json({ error: 'Winner not found' });
  if (!loser)  return res.status(404).json({ error: 'Loser not found' });

  const { newWinnerRating, newLoserRating, change } = calcElo(winner.rating, loser.rating);

  const game = {
    id:                 `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    winnerId:           winner.id,
    loserId:            loser.id,
    winnerRatingBefore: winner.rating,
    loserRatingBefore:  loser.rating,
    winnerRatingAfter:  newWinnerRating,
    loserRatingAfter:   newLoserRating,
    ratingChange:       change,
    playedAt:           new Date().toISOString(),
  };

  // Append to log (single atomic write)
  appendJsonl(gamesPath(league), game);

  // Update cache in-place — no re-replay needed
  winner.rating = newWinnerRating; winner.wins++;
  loser.rating  = newLoserRating;  loser.losses++;
  games.push(game);

  res.status(201).json({ ...game, winnerName: winner.name, loserName: loser.name });
});

app.delete('/api/games/:id', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { id } = req.params;
  const { winnerName } = req.body; // confirmation: caller must supply the winner's name

  const { games, players } = getCache(league);
  const game = games.find(g => g.id === id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  // Confirm the caller knows who won — guards against accidental deletion
  const winner = players.find(p => p.id === game.winnerId);
  const expectedName = winner ? winner.name.trim().toLowerCase() : '';
  if (!winnerName || winnerName.trim().toLowerCase() !== expectedName) {
    return res.status(403).json({ error: 'Winner name does not match' });
  }

  // Append tombstone to the log
  appendJsonl(gamesPath(league), { _tombstone: true, gameId: id, deletedAt: new Date().toISOString() });

  // Clear snapshots so the cold reload replays from scratch (snapshots predate the deletion)
  clearSnapshots(league);

  // Rebuild cache from scratch so all derived state (ratings, wins, losses) is correct
  leagueCache.delete(league);
  coldLoad(league);

  res.json({ ok: true });
});

// ── Avatar routes ─────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// GET /api/players/:id/avatar?league=pool — serve avatar or SVG initials fallback
app.get('/api/players/:id/avatar', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { id } = req.params;

  const { players } = getCache(league);
  const player = players.find(p => p.id === id);

  // Prefer user-level avatar, fall back to legacy per-player avatar
  const file = player ? resolveAvatarPath(player, league) : avatarPath(league, id);

  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', `public, max-age=${AVATAR_CACHE_SECS}`);
    return fs.createReadStream(file).pipe(res);
  }

  // No avatar — generate SVG initials; use userId for colour so it's consistent across leagues
  const colourKey = (player && player.userId) ? player.userId : id;
  const initials  = player
    ? player.name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('')
    : '?';

  const colours = ['#16a34a','#0d9488','#2563eb','#7c3aed','#c2410c','#b45309'];
  const colour  = colours[colourKey.charCodeAt(0) % colours.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <circle cx="100" cy="100" r="100" fill="${colour}"/>
    <text x="100" y="100" font-family="system-ui,sans-serif" font-size="80"
          font-weight="700" fill="white" text-anchor="middle" dominant-baseline="central">${initials}</text>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.send(svg);
});

// POST /api/players/:id/avatar?league=pool — upload, resize to 200×200, save as JPEG
app.post('/api/players/:id/avatar', upload.single('avatar'), async (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { id } = req.params;

  const { players } = getCache(league);
  const player = players.find(p => p.id === id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Save to user-level path if the player is linked to a user, else per-player path
    const savePath = resolveAvatarPath(player, league);
    const saveDir  = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    await sharp(req.file.buffer)
      .resize(200, 200, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toFile(savePath);

    res.json({ avatarUrl: `/api/players/${id}/avatar?league=${league}&v=${Date.now()}` });
  } catch (e) {
    console.error('Avatar upload error:', e);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`Pool League running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
});

module.exports = app; // for testing
