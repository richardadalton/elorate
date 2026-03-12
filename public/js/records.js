function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function load() {
  try {
    const r = await fetch('/api/records');
    if (!r.ok) throw new Error();
    const data = await r.json();
    render(data);
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<div class="empty-state">Failed to load records.</div>';
  }
}

function playerLink(id, name) {
  if (!id) return '<span class="no-record">No games yet</span>';
  return `<a class="player-link" href="/player.html?id=${esc(id)}">${esc(name)}</a>`;
}

function render(d) {
  const records = [
    {
      icon: '🔥',
      title: 'Longest Winning Streak',
      value: d.longestWinStreak.value
        ? `${d.longestWinStreak.value} Win${d.longestWinStreak.value !== 1 ? 's' : ''}`
        : '—',
      valueClass: 'green',
      holder: playerLink(d.longestWinStreak.playerId, d.longestWinStreak.playerName)
    },
    {
      icon: '📉',
      title: 'Longest Losing Streak',
      value: d.longestLossStreak.value
        ? `${d.longestLossStreak.value} Loss${d.longestLossStreak.value !== 1 ? 'es' : ''}`
        : '—',
      valueClass: 'red',
      holder: playerLink(d.longestLossStreak.playerId, d.longestLossStreak.playerName)
    },
    {
      icon: '🎱',
      title: 'Most Games Played',
      value: d.mostGamesPlayed.value ? `${d.mostGamesPlayed.value} Games` : '—',
      valueClass: 'accent',
      holder: playerLink(d.mostGamesPlayed.playerId, d.mostGamesPlayed.playerName)
    },
    {
      icon: '⭐',
      title: 'Highest Ever ELO',
      value: d.highestEloRating.value ? d.highestEloRating.value : '—',
      valueClass: 'accent',
      holder: playerLink(d.highestEloRating.playerId, d.highestEloRating.playerName)
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

