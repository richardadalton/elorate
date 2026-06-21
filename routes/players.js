const express = require('express');
const fs      = require('fs');
const {
  resolveLeague, getCache, readUsers, playersPath, appendJsonl,
  createPlayerRecord, avatarPath, resolveAvatarPath,
} = require('../lib/storage');
const { computePlayerStreaks, computeProfileResults, computeH2H } = require('../lib/stats');
const { computeKingOfTheHill, computeRecordMaps, computeBadges }  = require('../lib/badges');
const { generateAvatarSvg, saveAvatar, upload, AVATAR_CACHE_SECS } = require('../lib/avatar');

const router = express.Router();

router.get('/api/players', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const kingId = computeKingOfTheHill(games);

  const result = sorted.map(p => {
    const playerGames = games.filter(g => g.winnerId === p.id || g.loserId === p.id);
    const form = playerGames.slice(-5).map(g => g.winnerId === p.id ? 'W' : 'L');
    const { currentStreak } = computePlayerStreaks(p.id, playerGames);
    return { ...p, form, currentStreak };
  });

  res.json({ players: result, kingId });
});

// POST /api/leagues/:league/join — logged-in user joins a league (creates their player)
router.post('/api/leagues/:league/join', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const league = resolveLeague(req, res, req.params.league);
  if (!league) return;

  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { players } = getCache(league);

  const existingMember = players.find(p => p.userId === user.id);
  if (existingMember) {
    return res.status(400).json({ error: 'You are already in this league' });
  }

  // Auto-claim an unclaimed guest with the same name rather than creating a duplicate
  const nameLower   = user.name.trim().toLowerCase();
  const guestPlayer = players.find(p => !p.userId && p.name.trim().toLowerCase() === nameLower);
  if (guestPlayer) {
    guestPlayer.userId   = user.id;
    guestPlayer.joinedAt = new Date().toISOString();
    appendJsonl(playersPath(league), { _claim: true, id: guestPlayer.id, userId: user.id, claimedAt: guestPlayer.joinedAt });
    return res.status(200).json({ ...guestPlayer, autoClaimed: true });
  }

  const player = createPlayerRecord(user.name, user.id);
  appendJsonl(playersPath(league), { id: player.id, name: player.name, userId: player.userId, joinedAt: player.joinedAt });
  players.push(player);

  res.status(201).json(player);
});

// POST /api/players/:id/claim — logged-in user claims an unclaimed guest player
router.post('/api/players/:id/claim', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const league = resolveLeague(req, res);
  if (!league) return;

  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { players } = getCache(league);

  if (players.find(p => p.userId === user.id)) {
    return res.status(400).json({ error: 'You already have a player in this league' });
  }

  const player = players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  if (player.userId) return res.status(400).json({ error: 'Player is already claimed' });

  appendJsonl(playersPath(league), {
    _claim: true, id: player.id, userId: user.id, claimedAt: new Date().toISOString(),
  });
  player.userId = user.id;

  res.json({ ok: true, playerId: player.id, userId: user.id });
});

router.post('/api/players', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const { players } = getCache(league);
  const trimmed   = name.trim();
  const nameLower = trimmed.toLowerCase();

  const duplicate = players.find(p => p.name.toLowerCase() === nameLower);
  if (duplicate) return res.status(400).json({ error: 'Player already exists' });

  // If a registered user account has this display name, auto-link the player to them
  const matchingUser = readUsers().find(u => u.name.trim().toLowerCase() === nameLower);
  const linkedUserId = matchingUser ? matchingUser.id : null;

  if (linkedUserId && players.find(p => p.userId === linkedUserId)) {
    return res.status(400).json({ error: 'Player already exists' });
  }

  const player = createPlayerRecord(trimmed, linkedUserId);
  appendJsonl(playersPath(league), { id: player.id, name: player.name, userId: player.userId, joinedAt: player.joinedAt });
  players.push(player);

  res.status(201).json(player);
});

router.get('/api/players/:id/profile', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);

  const player = players.find(p => p.id === req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const playerGames = games.filter(g => g.winnerId === player.id || g.loserId === player.id);
  const position    = [...players].sort((a, b) => b.rating - a.rating).findIndex(p => p.id === player.id) + 1;
  const total       = player.wins + player.losses;

  const streaks = computePlayerStreaks(player.id, playerGames);
  const results = computeProfileResults(player, playerGames, players);
  const { rivals, nemeses } = computeH2H(player, playerGames, players);
  const { recHolders, biggestUpsetHolderId } = computeRecordMaps(players, games);

  const requestingUserId    = req.session.userId || null;
  const userAlreadyInLeague = requestingUserId
    ? players.some(p => p.userId === requestingUserId && p.id !== player.id)
    : false;
  const claimable = !player.userId && !!requestingUserId && !userAlreadyInLeague;

  res.json({
    id: player.id, name: player.name, userId: player.userId || null, rating: player.rating,
    position, totalPlayers: players.length,
    wins: player.wins, losses: player.losses, played: total,
    winPct: total ? Math.round((player.wins / total) * 100) : 0,
    claimable,
    results,
    longestWinStreak:  streaks.longestWinStreak,
    longestLossStreak: streaks.longestLossStreak,
    currentStreak:     streaks.currentStreak,
    highestRating:     player.highestRating,
    lowestRating:      player.lowestRating,
    badges: computeBadges(player, playerGames, players, games, recHolders, biggestUpsetHolderId),
    rivals, nemeses,
  });
});

// ── Avatar routes ─────────────────────────────────────────────────────────────

// GET /api/players/:id/avatar?league=pool — serve avatar or SVG initials fallback
router.get('/api/players/:id/avatar', (req, res) => {
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
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.send(generateAvatarSvg(player?.name ?? null, colourKey));
});

// POST /api/players/:id/avatar?league=pool — upload, resize to 200×200, save as JPEG
router.post('/api/players/:id/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });

  const league = resolveLeague(req, res);
  if (!league) return;
  const { id } = req.params;

  const { players } = getCache(league);
  const player = players.find(p => p.id === id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  if (!player.userId || player.userId !== req.session.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    await saveAvatar(req.file.buffer, resolveAvatarPath(player, league));
    res.json({ avatarUrl: `/api/players/${id}/avatar?league=${league}&v=${Date.now()}` });
  } catch (e) {
    console.error('Avatar upload error:', e);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

module.exports = router;
