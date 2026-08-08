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
  return parseJsonlFile(usersPath());
}

function appendUser(user) {
  ensureUsersFile();
  appendJsonl(usersPath(), user);
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

/**
 * Parse a JSONL file, skipping unparseable lines.
 * A torn line is expected history under crash recovery: a crash mid-append
 * leaves a partial line, and later appends push it into the middle of the
 * file. Skipped lines are warned about — a growing count without a known
 * crash means the file needs investigating.
 */
function parseJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = [];
  let bad = 0;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { parsed.push(JSON.parse(line)); } catch { bad++; }
  }
  if (bad) console.warn(`[elorate] ${filePath}: skipped ${bad} unparseable line(s) — likely torn write(s) from a crash`);
  return parsed;
}

/** Read all JSON lines from a file, applying tombstones and claim events. */
function readJsonl(filePath) {
  const lines = parseJsonlFile(filePath);

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

/**
 * If the file's last byte isn't a newline (torn write from a crash mid-append),
 * add one so the next record starts on its own line instead of concatenating
 * onto the torn fragment — which would make the good record unparseable too.
 */
function ensureTrailingNewline(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const { size } = fs.fstatSync(fd);
    if (size === 0) return;
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    if (buf[0] !== 0x0a) fs.appendFileSync(filePath, '\n');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Append a single object as a JSON line. */
function appendJsonl(filePath, obj) {
  ensureTrailingNewline(filePath);
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

  const allGames   = readJsonl(gamesPath(league));
  const rawPlayers = readJsonl(playersPath(league));
  const snap       = loadLatestSnapshot(league);

  let players;
  if (snap && snap.players && snap.players.length > 0) {
    // players.jsonl is the source of truth for who exists and for identity
    // fields (name, userId) — the snapshot only supplies derived stats.
    // Players who joined or were claimed after the snapshot must still be in
    // the base list, otherwise replayGames silently skips their games and
    // they render as 'Unknown'.
    const statsById = new Map(snap.players.map(p => [p.id, p]));
    const base = rawPlayers.map(p => {
      const snapStats = statsById.get(p.id);
      return snapStats
        ? { ...snapStats, name: p.name, userId: p.userId || null, joinedAt: p.joinedAt || snapStats.joinedAt }
        : { ...p, rating: INITIAL_RATING, wins: 0, losses: 0 };
    });
    const tail = allGames.filter(g => g.playedAt > snap.snapshotAt);
    players = replayGames(base, tail);
  } else {
    const base = rawPlayers.map(p => ({ ...p, rating: INITIAL_RATING, wins: 0, losses: 0 }));
    players = replayGames(base, allGames);
  }

  // Integrity check: a game referencing a player id that no longer resolves
  // means derived state has diverged from the log — surface it loudly.
  const knownIds = new Set(players.map(p => p.id));
  for (const g of allGames) {
    if (!knownIds.has(g.winnerId) || !knownIds.has(g.loserId)) {
      console.warn(`[elorate] league "${league}": game ${g.id} references unknown player (winnerId=${g.winnerId}, loserId=${g.loserId})`);
    }
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
