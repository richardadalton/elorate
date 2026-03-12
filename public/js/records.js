function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatLeagueName(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function load() {
  const league = localStorage.getItem('currentLeague') || 'pool';
  document.querySelector('header p').textContent =
    `All-time bests — ${formatLeagueName(league)}`;

  try {
    const r = await fetch(`/api/records?league=${league}`);
    if (!r.ok) throw new Error();
    const data = await r.json();
    render(data, league);
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<div class="empty-state">Failed to load records.</div>';
  }
}

function playerLinks(holders, league) {
  if (!holders || holders.length === 0) return '<span class="no-record">No games yet</span>';
  return holders
    .map(h => `<a class="player-link" href="/player.html?id=${esc(h.id)}&league=${esc(league)}">${esc(h.name)}</a>`)
    .join('<span class="holder-sep">,&nbsp;</span>');
}

function upsetHolder(upset, league) {
  if (!upset || !upset.winnerId) return '<span class="no-record">No games yet</span>';
  const winner = `<a class="player-link" href="/player.html?id=${esc(upset.winnerId)}&league=${esc(league)}">${esc(upset.winnerName)}</a>`;
  const loser  = `<a class="player-link" href="/player.html?id=${esc(upset.loserId)}&league=${esc(league)}">${esc(upset.loserName)}</a>`;
  return `${winner}<span class="upset-sep">beat</span>${loser}`;
}

function render(d, league) {
  const records = [
    {
      icon: '🔥',
      title: 'Longest Winning Streak',
      value: d.longestWinStreak.value
        ? `${d.longestWinStreak.value} Win${d.longestWinStreak.value !== 1 ? 's' : ''}`
        : '—',
      valueClass: 'green',
      holder: playerLinks(d.longestWinStreak.holders, league)
    },
    {
      icon: '⚡',
      title: 'Longest Active Streak',
      value: d.longestActiveWinStreak.value
        ? `${d.longestActiveWinStreak.value} Win${d.longestActiveWinStreak.value !== 1 ? 's' : ''}`
        : '—',
      valueClass: 'green',
      holder: playerLinks(d.longestActiveWinStreak.holders, league)
    },
    {
      icon: '🎱',
      title: 'Most Games Played',
      value: d.mostGamesPlayed.value ? `${d.mostGamesPlayed.value} Games` : '—',
      valueClass: 'accent',
      holder: playerLinks(d.mostGamesPlayed.holders, league)
    },
    {
      icon: '🏆',
      title: 'Most Games Won',
      value: d.mostGamesWon.value ? `${d.mostGamesWon.value} Wins` : '—',
      valueClass: 'green',
      holder: playerLinks(d.mostGamesWon.holders, league)
    },
    {
      icon: '⭐',
      title: 'Highest Ever ELO',
      value: d.highestEloRating.value ? d.highestEloRating.value : '—',
      valueClass: 'accent',
      holder: playerLinks(d.highestEloRating.holders, league)
    },
    {
      icon: '🎯',
      title: 'Biggest Upset',
      value: d.biggestUpset.ratingDiff ? `+${d.biggestUpset.ratingDiff} pts` : '—',
      valueClass: 'red',
      holder: upsetHolder(d.biggestUpset, league)
    }
  ];

  document.getElementById('root').innerHTML = `
    <div class="records-grid">
      ${records.map(rec => `
        <div class="record-card">
          <div class="record-icon">${rec.icon}</div>
          <div class="record-title">${rec.title}</div>
          <div class="record-value ${rec.valueClass}">${rec.value}</div>
          <div class="record-holder">${rec.holder}</div>
        </div>
      `).join('')}
    </div>
  `;
}

load();
