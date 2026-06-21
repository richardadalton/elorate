const express = require('express');
const {
  resolveLeague, getCache, gamesPath, appendJsonl,
  leagueCache, coldLoad, clearSnapshotsAfter,
} = require('../lib/storage');
const { calcElo }     = require('../lib/elo');
const { playerName }  = require('../lib/stats');

const router = express.Router();

router.get('/api/games', (req, res) => {
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

router.post('/api/games', (req, res) => {
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

  // Only store the immutable identity fields — ratings are always derived on load
  const logEntry = {
    id:       `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    winnerId: winner.id,
    loserId:  loser.id,
    playedAt: new Date().toISOString(),
  };

  appendJsonl(gamesPath(league), logEntry);

  // Update cache in-place
  const { newWinnerRating, newLoserRating, change } = calcElo(winner.rating, loser.rating);

  const upsetDiff = loser.rating - winner.rating;
  if (upsetDiff > 0 && (!winner.biggestUpset || upsetDiff > winner.biggestUpset.diff)) {
    winner.biggestUpset = { diff: upsetDiff, opponentId: loser.id, gameId: logEntry.id };
  }
  const topRating = Math.max(...players.map(p => p.rating));
  if (loser.rating >= topRating) winner.beatTop = true;

  winner.rating = newWinnerRating; winner.wins++;
  loser.rating  = newLoserRating;  loser.losses++;
  if (winner.rating > winner.highestRating) winner.highestRating = winner.rating;
  if (winner.rating < winner.lowestRating)  winner.lowestRating  = winner.rating;
  if (loser.rating  > loser.highestRating)  loser.highestRating  = loser.rating;
  if (loser.rating  < loser.lowestRating)   loser.lowestRating   = loser.rating;

  games.push(logEntry);

  res.status(201).json({ ...logEntry, winnerName: winner.name, loserName: loser.name, ratingChange: change });
});

router.delete('/api/games/:id', (req, res) => {
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

  appendJsonl(gamesPath(league), { _tombstone: true, gameId: id, deletedAt: new Date().toISOString() });

  // Only clear snapshots taken at or after this game — earlier snapshots are still valid
  clearSnapshotsAfter(league, game.playedAt);

  // Rebuild cache from scratch so all derived state is correct
  leagueCache.delete(league);
  coldLoad(league);

  res.json({ ok: true });
});

module.exports = router;
