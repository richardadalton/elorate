const express = require('express');
const { resolveLeague, getCache } = require('../lib/storage');
const { computeRecordMaps }       = require('../lib/badges');
const { playerName }              = require('../lib/stats');

const router = express.Router();

router.get('/api/records', (req, res) => {
  const league = resolveLeague(req, res);
  if (!league) return;
  const { players, games } = getCache(league);

  const { recVals, recHolders } = computeRecordMaps(players, games);

  // Translate Set<id> → [{ id, name }] for the response
  function toHolders(set) {
    return [...set].map(id => ({ id, name: playerName(players, id) }));
  }

  // Biggest upset — read from player aggregates computed during replay
  let biggestUpset = { ratingDiff: 0, winnerId: null, winnerName: null, loserId: null, loserName: null };
  for (const player of players) {
    if (!player.biggestUpset) continue;
    if (player.wins + player.losses === 0) continue;
    const { diff, opponentId } = player.biggestUpset;
    if (diff > biggestUpset.ratingDiff) {
      biggestUpset = {
        ratingDiff: diff,
        winnerId:   player.id,
        winnerName: player.name,
        loserId:    opponentId,
        loserName:  playerName(players, opponentId),
      };
    }
  }

  res.json({
    longestWinStreak:       { value: recVals.longestWinStreak,       holders: toHolders(recHolders.longestWinStreak) },
    longestActiveWinStreak: { value: recVals.longestActiveWinStreak, holders: toHolders(recHolders.longestActiveWinStreak) },
    mostGamesPlayed:        { value: recVals.mostGamesPlayed,        holders: toHolders(recHolders.mostGamesPlayed) },
    mostGamesWon:           { value: recVals.mostGamesWon,           holders: toHolders(recHolders.mostGamesWon) },
    highestEloRating:       { value: recVals.highestEloRating,       holders: toHolders(recHolders.highestEloRating) },
    defendTheHill:          { value: recVals.defendTheHill,          holders: toHolders(recHolders.defendTheHill) },
    biggestUpset,
  });
});

module.exports = router;
