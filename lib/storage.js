const fs   = require('fs');
const path = require('path');
const { INITIAL_RATING, replayGames } = require('./elo');

const DATA_DIR      = process.env.TEST_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SNAPSHOT_DAYS = 30;

// ── User storage ──────────────────────────────────────────────────────────────
// Users are global (not per-league): data/users.jsonl
// Each line: { id, name, email, passwordHash, createdAt }

function usersPath() { return path.join(DATA_DIR, 'users.jsonl'); }

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

// ── League file paths ─────────────────────────────────────────────────────────
//
// Layout on disk (one sub-directory per league):
//   data/<league>/players.jsonl    — one JSON object per line, append-only
//   data/<league>/games.jsonl      — one JSON object per line, append-only
//   data/<league>/snapshots/       — periodic snapshots of derived state

function leagueDir(league)            { return path.join(DATA_DIR, league); }
function playersPath(league)          { return path.join(leagueDir(league), 'players.jsonl'); }
function gamesPath(league)            { return path.join(leagueDir(league), 'games.jsonl'); }
function snapshotsDir(league)         { return path.join(leagueDir(league), 'snapshots'); }
function avatarsDir(league)           { return path.join(leagueDir(league), 'avatars'); }
function avatarPath(league, playerId) { return path.join(avatarsDir(league), `${playerId}.jpg`); }

// Global user avatars — stored at data/avatars/<userId>.jpg (not per-league)
function userAvatarsDir()       { return path.join(DATA_DIR, 'avatars'); }
function userAvatarPath(userId) { return path.join(userAvatarsDir(), `${userId}.jpg`); }

/** Return the avatar file path for a player — user-level if linked, else player-level. */
function resolveAvatarPath(player, league) {
  if (player && player.userId) return userAvatarPath(player.userId);
  return avatarPath(league, player ? player.id : '');
}

// ── Append-only persistence ───────────────────────────────────────────────────

function ensureLeagueDir(league) {
  fs.mkdirSync(leagueDir(league),    { recursive: true });
  fs.mkdirSync(snapshotsDir(league), { recursive: true });
  if (!fs.existsSync(playersPath(league))) fs.writeFileSync(playersPath(league), '');
  if (!fs.existsSync(gamesPath(league)))   fs.writeFileSync(gamesPath(league),   '');
}

/** Read all JSON lines from a file, applying tombstones and claim events. */
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
  lines.filter(l => l._claim).forEach(l => { claims[l.id] = { userId: l.userId, claimedAt: l.claimedAt }; });

  return lines
    .filter(l => !l._tombstone && !l._claim && !deleted.has(l.id))
    .map(l => {
      if (claims[l.id]) return { ...l, userId: claims[l.id].userId, joinedAt: claims[l.id].claimedAt };
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
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
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
  const filename   = snapshotAt.slice(0, 10) + '.json';
  fs.writeFileSync(
    path.join(snapshotsDir(league), filename),
    JSON.stringify({ snapshotAt, players }, null, 2)
  );
}

/** Days elapsed since an ISO date string. */
function daysSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Delete snapshot files taken at or after `gamePlayedAt`.
 * Snapshots before the deleted game are still valid and kept.
 */
function clearSnapshotsAfter(league, gamePlayedAt) {
  const dir = snapshotsDir(league);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .forEach(f => {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (snap.snapshotAt >= gamePlayedAt) fs.unlinkSync(path.join(dir, f));
      } catch {
        fs.unlinkSync(path.join(dir, f)); // remove unreadable snapshots
      }
    });
}

function maybeAutoSnapshot(league, players) {
  if (players.length === 0) return;
  const snap = loadLatestSnapshot(league);
  if (!snap || daysSince(snap.snapshotAt) >= SNAPSHOT_DAYS) writeSnapshot(league, players);
}

// ── Per-league in-memory cache ────────────────────────────────────────────────
//
// leagueCache: Map<slug, { players: Player[], games: Game[] }>
// Populated lazily on first request; updated in-place on writes; cleared on restart.

const leagueCache = new Map();

/**
 * Cold-load a league into the cache.
 * Uses snapshot + tail replay for player state (bounded to ≤30 days of games).
 */
function coldLoad(league) {
  ensureLeagueDir(league);

  const allGames = readJsonl(gamesPath(league));
  const snap     = loadLatestSnapshot(league);

  let players;
  if (snap && snap.players && snap.players.length > 0) {
    const tail = allGames.filter(g => g.playedAt > snap.snapshotAt);
    players = replayGames(snap.players, tail);
  } else {
    const rawPlayers = readJsonl(playersPath(league));
    const base = rawPlayers.map(p => ({ ...p, rating: INITIAL_RATING, wins: 0, losses: 0 }));
    players = replayGames(base, allGames);
  }

  maybeAutoSnapshot(league, players);
  leagueCache.set(league, { players, games: allGames });
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

// ── Player helpers ────────────────────────────────────────────────────────────

/** Build a new in-memory player object with default ELO values. */
function createPlayerRecord(name, userId) {
  return {
    id:            `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    userId:        userId || null,
    joinedAt:      new Date().toISOString(),
    rating:        INITIAL_RATING,
    wins:          0,
    losses:        0,
    highestRating: INITIAL_RATING,
    lowestRating:  INITIAL_RATING,
    biggestUpset:  null,
    beatTop:       false,
  };
}

// ── Route helper ──────────────────────────────────────────────────────────────

function resolveLeague(req, res, leagueOverride) {
  const league = (leagueOverride || req.query.league || 'pool').toLowerCase();
  if (!validLeague(league))  { res.status(400).json({ error: 'Invalid league' });    return null; }
  if (!leagueExists(league)) { res.status(404).json({ error: 'League not found' }); return null; }
  return league;
}

module.exports = {
  DATA_DIR,
  usersPath, ensureUsersFile, readUsers, appendUser,
  leagueDir, playersPath, gamesPath, snapshotsDir, avatarsDir, avatarPath,
  userAvatarsDir, userAvatarPath, resolveAvatarPath,
  ensureLeagueDir, readJsonl, appendJsonl,
  loadLatestSnapshot, writeSnapshot, clearSnapshotsAfter, maybeAutoSnapshot,
  leagueCache, coldLoad, getCache,
  getLeagues, validLeague, leagueExists,
  createPlayerRecord,
  resolveLeague,
};
