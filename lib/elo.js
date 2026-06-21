const INITIAL_RATING = 1000;
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

/**
 * Replay all games from a base player list and return fully-derived player state.
 *
 * All derived data is tracked as player-level aggregates — nothing is written
 * back to the game objects. Games remain pure identity records: { id, winnerId,
 * loserId, playedAt }.
 *
 * Each player in the returned array carries:
 *   rating, wins, losses
 *   highestRating, lowestRating
 *   biggestUpset: { diff, opponentId, gameId } | null   (for biggest-upset record)
 *   beatTop: boolean                                     (for Giant Killer badge)
 */
function replayGames(basePlayers, games) {
  const state = new Map();
  for (const p of basePlayers) {
    state.set(p.id, {
      id:            p.id,
      name:          p.name,
      userId:        p.userId || null,
      joinedAt:      p.joinedAt || null,
      rating:        typeof p.rating  === 'number' ? p.rating  : INITIAL_RATING,
      wins:          typeof p.wins    === 'number' ? p.wins    : 0,
      losses:        typeof p.losses  === 'number' ? p.losses  : 0,
      highestRating: typeof p.highestRating === 'number' ? p.highestRating : (typeof p.rating === 'number' ? p.rating : INITIAL_RATING),
      lowestRating:  typeof p.lowestRating  === 'number' ? p.lowestRating  : (typeof p.rating === 'number' ? p.rating : INITIAL_RATING),
      biggestUpset:  p.biggestUpset || null,
      beatTop:       p.beatTop      || false,
    });
  }

  // Track the current top rating as a running value to avoid O(n) spread per game
  let topRating = 0;
  for (const p of state.values()) if (p.rating > topRating) topRating = p.rating;

  for (const g of games) {
    const w = state.get(g.winnerId);
    const l = state.get(g.loserId);
    if (!w || !l) continue;

    const { newWinnerRating, newLoserRating } = calcElo(w.rating, l.rating);

    // Beat the top-rated player — check before advancing ratings
    if (l.rating >= topRating) w.beatTop = true;

    // Biggest upset — track on the winner
    const upsetDiff = l.rating - w.rating;
    if (upsetDiff > 0 && (!w.biggestUpset || upsetDiff > w.biggestUpset.diff)) {
      w.biggestUpset = { diff: upsetDiff, opponentId: l.id, gameId: g.id };
    }

    w.rating = newWinnerRating; w.wins++;
    l.rating = newLoserRating;  l.losses++;

    if (w.rating > w.highestRating) w.highestRating = w.rating;
    if (w.rating < w.lowestRating)  w.lowestRating  = w.rating;
    if (l.rating > l.highestRating) l.highestRating = l.rating;
    if (l.rating < l.lowestRating)  l.lowestRating  = l.rating;

    // Only the winner's rating can increase
    if (w.rating > topRating) topRating = w.rating;
  }

  return [...state.values()];
}

module.exports = { INITIAL_RATING, calcElo, replayGames };
