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
  // Keep name short — validLeague enforces a 40-char max.
  // Use last 8 digits of timestamp + 4-char random to guarantee uniqueness.
  const ts   = Date.now().toString().slice(-8);
  const rand = Math.random().toString(36).slice(2, 6);
  const name = `tl_${ts}_${rand}${suffix}`;
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

/**
 * Register a test user and log in via the API.
 * Returns { email, password } — use with page.goto after calling this
 * so the session cookie is present in the browser context.
 *
 * Usage:
 *   const creds = await registerAndLogin(request);
 *   await page.goto(`${BASE}/?league=${league}`);
 *   // page is now logged in
 */
async function registerAndLogin(request, suffix = '') {
  const ts    = Date.now().toString().slice(-8);
  const email = `test_${ts}${suffix}@test.com`;
  const password = 'testpass123';
  const name     = `Tester_${ts}${suffix}`;

  // Register (also logs in via session)
  const res = await request.post(`${BASE}/api/auth/register`, {
    data: { name, email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Failed to register: ${await res.text()}`);
  return { email, password, name };
}

module.exports = { BASE, createTestLeague, addPlayer, recordGame, registerAndLogin };


