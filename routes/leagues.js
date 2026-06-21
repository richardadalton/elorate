const express = require('express');
const { getLeagues, validLeague, leagueExists, ensureLeagueDir } = require('../lib/storage');

const router = express.Router();

router.get('/api/leagues', (_req, res) => {
  res.json(getLeagues());
});

router.post('/api/leagues', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (!validLeague(slug)) return res.status(400).json({ error: 'Invalid league name' });
  if (leagueExists(slug)) return res.status(400).json({ error: 'League already exists' });
  ensureLeagueDir(slug);
  res.status(201).json({ league: slug });
});

module.exports = router;
