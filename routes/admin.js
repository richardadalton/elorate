const express = require('express');
const { resolveLeague, getCache, writeSnapshot } = require('../lib/storage');

const router = express.Router();

router.post('/api/admin/snapshot', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players } = getCache(league);
  writeSnapshot(league, players);
  res.json({ ok: true, snapshotAt: new Date().toISOString(), players: players.length });
});

module.exports = router;
