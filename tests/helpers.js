/**
 * Shared API helpers used across test files.
 * All requests go to the test server (baseURL set in playwright.config.js).
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001';

/**
 * Create a fresh test league with a unique name so tests don't pollute each other.
 * Returns the league slug.
 */
async function createTestLeague(request, suffix = '') {
  const name = `testleague_${Date.now()}${suffix}`;
  const res = await request.post(`${BASE}/api/leagues`, {
    data: { name },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Failed to create league: ${await res.text()}`);
  const body = await res.json();
  return body.league;
}

/**
 * Add a player to a league. Returns the created player object.
 */
async function addPlayer(request, league, name) {
  const res = await request.post(`${BASE}/api/players?league=${league}`, {
    data: { name },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Failed to add player "${name}": ${await res.text()}`);
  return await res.json();
}

/**
 * Record a game result. Returns the game object.
 */
async function recordGame(request, league, winnerId, loserId) {
  const res = await request.post(`${BASE}/api/games?league=${league}`, {
    data: { winnerId, loserId },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Failed to record game: ${await res.text()}`);
  return await res.json();
}

module.exports = { BASE, createTestLeague, addPlayer, recordGame };


