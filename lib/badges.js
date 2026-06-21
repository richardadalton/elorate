const { computePlayerStreaks } = require('./stats');

const BADGE_DEFS = [
  { id: 'first_win',        name: 'First Win',        icon: '🥇', desc: 'Win your first game' },
  { id: 'games_10',         name: 'Veteran',           icon: '🎮', desc: 'Play 10 games' },
  { id: 'games_50',         name: 'Seasoned',          icon: '🏅', desc: 'Play 50 games' },
  { id: 'games_100',        name: 'Centurion',         icon: '💯', desc: 'Play 100 games' },
  { id: 'beat_top',         name: 'Giant Killer',      icon: '🗡️', desc: 'Beat the top rated player' },
  { id: 'achieve_record',   name: 'Record Holder',     icon: '📈', desc: 'Hold at least one all-time record' },
  { id: 'all_records',      name: 'Grand Slam',        icon: '🏆', desc: 'Hold all six records simultaneously (sole holder, no ties)' },
  { id: 'king_of_the_hill', name: 'King of the Hill',  icon: '👑', desc: 'Win the first ever game or beat the reigning King of the Hill' }
];

// Walk the game history chronologically — the winner of the first game
// becomes king; the title transfers whenever the current king loses.
// Games are stored in append order (chronological) so no sort is needed.
function computeKingOfTheHill(games) {
  if (!games.length) return null;
  let kingId = games[0].winnerId;
  for (let i = 1; i < games.length; i++) {
    if (games[i].loserId === kingId) kingId = games[i].winnerId;
  }
  return kingId;
}

/** Return the player ID who holds the current biggest upset, or null if none. */
function computeBiggestUpsetHolder(players) {
  let best = 0, holderId = null;
  for (const p of players) {
    if (p.biggestUpset && p.biggestUpset.diff > best) {
      best = p.biggestUpset.diff;
      holderId = p.id;
    }
  }
  return holderId;
}

function computeRecordMaps(players, games) {
  const recVals = {
    longestWinStreak: 0, mostGamesPlayed: 0, mostGamesWon: 0,
    highestEloRating: 0, longestActiveWinStreak: 0, defendTheHill: 0,
  };
  const recHolders = {
    longestWinStreak: new Set(), mostGamesPlayed: new Set(), mostGamesWon: new Set(),
    highestEloRating: new Set(), longestActiveWinStreak: new Set(), defendTheHill: new Set(),
  };

  function track(key, value, pid) {
    if (value > recVals[key])                     { recVals[key] = value; recHolders[key] = new Set([pid]); }
    else if (value === recVals[key] && value > 0) { recHolders[key].add(pid); }
  }

  for (const p of players) {
    const pg = games.filter(g => g.winnerId === p.id || g.loserId === p.id);
    if (pg.length === 0) continue; // must have played at least one game to hold a record

    track('mostGamesPlayed', p.wins + p.losses, p.id);
    track('mostGamesWon',    p.wins,             p.id);

    const { longestWinStreak, activeWinStreak } = computePlayerStreaks(p.id, pg);
    track('highestEloRating',       p.highestRating,  p.id);
    track('longestWinStreak',       longestWinStreak, p.id);
    track('longestActiveWinStreak', activeWinStreak,  p.id);
  }

  // Defend the Hill — games are already in chronological order in the cache
  const defendBest = {};
  if (games.length) {
    let kingId = games[0].winnerId;
    let curDefend = 0;
    for (let i = 1; i < games.length; i++) {
      const g = games[i];
      if (g.winnerId === kingId) {
        curDefend++;
        defendBest[kingId] = Math.max(defendBest[kingId] || 0, curDefend);
      } else if (g.loserId === kingId) {
        kingId    = g.winnerId;
        curDefend = 0;
      }
      // else: game doesn't involve the king — ignore entirely
    }
  }
  for (const p of players) track('defendTheHill', defendBest[p.id] || 0, p.id);

  return { recVals, recHolders, biggestUpsetHolderId: computeBiggestUpsetHolder(players) };
}

function computeBadges(player, playerGames, allPlayers, allGames, recHolders, biggestUpsetHolderId) {
  const earned = new Set();
  const played = player.wins + player.losses;

  if (player.wins >= 1)   earned.add('first_win');
  if (played >= 10)       earned.add('games_10');
  if (played >= 50)       earned.add('games_50');
  if (played >= 100)      earned.add('games_100');

  if (player.beatTop) earned.add('beat_top');

  const holdsAny = Object.values(recHolders).some(s => s.has(player.id))
                || biggestUpsetHolderId === player.id;
  const holdsAll = Object.values(recHolders).every(s => s.size === 1 && s.has(player.id));
  if (holdsAny) earned.add('achieve_record');
  if (holdsAll) earned.add('all_records');

  if (computeKingOfTheHill(allGames) === player.id) earned.add('king_of_the_hill');

  return BADGE_DEFS.map(b => ({ ...b, earned: earned.has(b.id) }));
}

module.exports = { BADGE_DEFS, computeKingOfTheHill, computeRecordMaps, computeBiggestUpsetHolder, computeBadges };
