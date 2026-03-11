// ── Helpers ──────────────────────────────────────────────────────────────────

function setMsg(id, text, isErr) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + (isErr ? 'err' : 'ok');
  if (text) setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 3500);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ── Fetch wrappers ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── XSS safety ───────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render League Table ───────────────────────────────────────────────────────

async function loadLeague() {
  const players = await api('GET', '/api/players');
  const wrap = document.getElementById('league-table-wrap');

  if (!players.length) {
    wrap.innerHTML = '<div class="empty-state">No players yet — add some below!</div>';
    return players;
  }

  const rows = players.map((p, i) => {
    const rank = i + 1;
    const posClass = rank <= 3 ? `pos-${rank}` : '';
    const total = p.wins + p.losses;
    const pct = total ? Math.round((p.wins / total) * 100) : 0;
    return `
      <tr>
        <td class="pos ${posClass}">${rank}</td>
        <td class="player-name"><a href="/player.html?id=${p.id}" class="player-link">${esc(p.name)}</a></td>
        <td class="num"><span class="rating-badge">${p.rating}</span></td>
        <td class="num">${p.wins}</td>
        <td class="num">${p.losses}</td>
        <td class="num win-pct">${total ? pct + '%' : '—'}</td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th class="num">ELO</th>
          <th class="num">W</th>
          <th class="num">L</th>
          <th class="num">Win%</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return players;
}

// ── Render History ────────────────────────────────────────────────────────────

async function loadHistory() {
  const games = await api('GET', '/api/games');
  const list = document.getElementById('history-list');

  if (!games.length) {
    list.innerHTML = '<div class="empty-state">No games recorded yet.</div>';
    return;
  }

  list.innerHTML = games.slice(0, 50).map(g => `
    <div class="game-item">
      <div class="vs">
        <span class="game-winner">${esc(g.winnerName)}</span>
        <span class="vs-sep">beat</span>
        <span class="game-loser">${esc(g.loserName)}</span>
      </div>
      <span class="game-change">+${g.ratingChange} pts</span>
      <span class="game-time">${fmtDate(g.playedAt)}</span>
    </div>`).join('');
}

// ── Populate selects ──────────────────────────────────────────────────────────

function populateSelects(players) {
  const ws = document.getElementById('winner-select');
  const ls = document.getElementById('loser-select');
  const wVal = ws.value, lVal = ls.value;

  const opts = players.map(p =>
    `<option value="${p.id}">${esc(p.name)} (${p.rating})</option>`
  ).join('');

  ws.innerHTML = '<option value="">🏆 Winner…</option>' + opts;
  ls.innerHTML = '<option value="">💀 Loser…</option>' + opts;

  if (wVal) ws.value = wVal;
  if (lVal) ls.value = lVal;
}

// ── Full refresh ──────────────────────────────────────────────────────────────

async function refresh() {
  try {
    const players = await loadLeague();
    populateSelects(players);
    await loadHistory();
  } catch (e) {
    console.error(e);
  }
}

// ── Add player ────────────────────────────────────────────────────────────────

async function addPlayer() {
  const input = document.getElementById('new-player-name');
  const name = input.value.trim();
  if (!name) return setMsg('player-msg', 'Please enter a name.', true);
  try {
    await api('POST', '/api/players', { name });
    input.value = '';
    setMsg('player-msg', `${name} added!`, false);
    await refresh();
  } catch (e) {
    setMsg('player-msg', e.message, true);
  }
}

// ── Record game ───────────────────────────────────────────────────────────────

async function recordGame() {
  const winnerId = document.getElementById('winner-select').value;
  const loserId  = document.getElementById('loser-select').value;

  if (!winnerId) return setMsg('game-msg', 'Select a winner.', true);
  if (!loserId)  return setMsg('game-msg', 'Select a loser.', true);
  if (winnerId === loserId) return setMsg('game-msg', 'Winner and loser must be different.', true);

  const btn = document.getElementById('record-btn');
  btn.disabled = true;
  try {
    const g = await api('POST', '/api/games', { winnerId, loserId });
    setMsg('game-msg', `✅ ${g.winnerName} beat ${g.loserName} (+${g.ratingChange} pts)`, false);
    document.getElementById('winner-select').value = '';
    document.getElementById('loser-select').value  = '';
    await refresh();
  } catch (e) {
    setMsg('game-msg', e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

refresh();

