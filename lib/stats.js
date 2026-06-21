/** Look up a player's name by id, falling back to 'Unknown'. */
function playerName(players, id) {
  return players.find(p => p.id === id)?.name ?? 'Unknown';
}

/**
 * Derive streak data from the player's game list.
 * Returns: { longestWinStreak, longestLossStreak, currentStreak, activeWinStreak }
 */
function computePlayerStreaks(playerId, playerGames) {
  let longestWin = 0, longestLoss = 0, curWin = 0, curLoss = 0;

  for (const g of playerGames) {
    if (g.winnerId === playerId) {
      curWin++; curLoss = 0;
      if (curWin  > longestWin)  longestWin  = curWin;
    } else {
      curLoss++; curWin = 0;
      if (curLoss > longestLoss) longestLoss = curLoss;
    }
  }

  const currentStreak = playerGames.length === 0
    ? { type: null, count: 0 }
    : playerGames[playerGames.length - 1].winnerId === playerId
      ? { type: 'W', count: curWin }
      : { type: 'L', count: curLoss };

  const activeWinStreak = currentStreak.type === 'W' ? curWin : 0;

  return { longestWinStreak: longestWin, longestLossStreak: longestLoss,
           currentStreak, activeWinStreak };
}

/** Build the results history array (most-recent first) for a player's profile. */
function computeProfileResults(player, playerGames, players) {
  return [...playerGames].reverse().map(g => ({
    result:   g.winnerId === player.id ? 'W' : 'L',
    opponent: playerName(players, g.winnerId === player.id ? g.loserId : g.winnerId),
    playedAt: g.playedAt,
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

module.exports = { playerName, computePlayerStreaks, computeProfileResults, computeH2H };
