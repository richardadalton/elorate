const express = require('express');
const fs      = require('fs');
const {
  readUsers, getLeagues, getCache, userAvatarPath,
} = require('../lib/storage');
const { computePlayerStreaks }              = require('../lib/stats');
const { computeRecordMaps, computeBadges } = require('../lib/badges');
const { generateAvatarSvg, saveAvatar, upload, AVATAR_CACHE_SECS } = require('../lib/avatar');

const router = express.Router();

// GET /api/users/:id/profile — public user profile with cross-league stats
router.get('/api/users/:id/profile', (req, res) => {
  const users = readUsers();
  const user  = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const leagueStats = [];

  for (const league of getLeagues()) {
    const { players, games } = getCache(league);
    const player = players.find(p => p.userId === user.id);
    if (!player) continue;

    const playerGames = games.filter(g => g.winnerId === player.id || g.loserId === player.id);
    const sorted      = [...players].sort((a, b) => b.rating - a.rating);
    const position    = sorted.findIndex(p => p.id === player.id) + 1;
    const total       = player.wins + player.losses;
    const form        = playerGames.slice(-5).map(g => g.winnerId === player.id ? 'W' : 'L');
    const { currentStreak } = computePlayerStreaks(player.id, playerGames);
    const { recHolders, biggestUpsetHolderId } = computeRecordMaps(players, games);
    const badges = computeBadges(player, playerGames, players, games, recHolders, biggestUpsetHolderId);

    leagueStats.push({
      league,
      playerId:     player.id,
      position,
      totalPlayers: players.length,
      rating:       player.rating,
      wins:         player.wins,
      losses:       player.losses,
      played:       total,
      winPct:       total ? Math.round((player.wins / total) * 100) : 0,
      form,
      currentStreak,
      badges,
    });
  }

  res.json({
    id:        user.id,
    name:      user.name,
    createdAt: user.createdAt,
    leagues:   leagueStats,
  });
});

// GET /api/users/:id/avatar — serve user-level avatar or SVG initials fallback
router.get('/api/users/:id/avatar', (req, res) => {
  const users = readUsers();
  const user  = users.find(u => u.id === req.params.id);
  const file  = userAvatarPath(req.params.id);

  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', `public, max-age=${AVATAR_CACHE_SECS}`);
    return fs.createReadStream(file).pipe(res);
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.send(generateAvatarSvg(user?.name ?? null, req.params.id));
});

// POST /api/users/:id/avatar — upload, resize to 200×200, save as JPEG (own profile only)
router.post('/api/users/:id/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.userId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    await saveAvatar(req.file.buffer, userAvatarPath(req.params.id));
    res.json({ avatarUrl: `/api/users/${req.params.id}/avatar?v=${Date.now()}` });
  } catch (e) {
    console.error('User avatar upload error:', e);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

module.exports = router;
