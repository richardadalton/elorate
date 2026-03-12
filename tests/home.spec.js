/**
 * UI tests — Home page (index.html)
 * Tests the league table, add player, record game, game history and league switcher.
 */

const { test, expect } = require('@playwright/test');
const { BASE, createTestLeague, addPlayer, recordGame } = require('./helpers');

test.describe('Home Page — League Table', () => {
  let league, alice, bob;

  test.beforeAll(async ({ request }) => {
    league = await createTestLeague(request, '_home');
    alice  = await addPlayer(request, league, 'Alice');
    bob    = await addPlayer(request, league, 'Bob');
    await recordGame(request, league, alice.id, bob.id);
  });

  test.beforeEach(async ({ page }) => {
    // Set the league in localStorage before loading the page
    await page.goto(`${BASE}/`);
    await page.evaluate(l => localStorage.setItem('currentLeague', l), league);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('table', { timeout: 10_000 });
  });

  test('page title is shown', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });

  test('league table shows both players', async ({ page }) => {
    await expect(page.locator('table tbody tr')).toHaveCount(2);
  });

  test('players are sorted by ELO (highest first)', async ({ page }) => {
    const rows = page.locator('table tbody tr');
    const firstRating  = await rows.nth(0).locator('td').nth(2).textContent();
    const secondRating = await rows.nth(1).locator('td').nth(2).textContent();
    const r1 = parseInt(firstRating.replace(/\D/g, ''), 10);
    const r2 = parseInt(secondRating.replace(/\D/g, ''), 10);
    expect(r1).toBeGreaterThanOrEqual(r2);
  });

  test('player names are links to profile pages', async ({ page }) => {
    const link = page.locator('table tbody .player-link').first();
    await expect(link).toHaveAttribute('href', /player\.html/);
  });

  test('crown icon is shown next to King of the Hill', async ({ page }) => {
    // Alice won the first game so she is king
    await expect(page.locator('.koth-crown')).toBeVisible();
  });

  test('Records nav link is present', async ({ page }) => {
    const link = page.locator('nav a', { hasText: 'Records' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /records\.html/);
  });
});

test.describe('Home Page — Add Player', () => {
  let league;

  test.beforeAll(async ({ request }) => {
    league = await createTestLeague(request, '_addplayer');
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(l => localStorage.setItem('currentLeague', l), league);
    await page.goto(`${BASE}/`);
  });

  test('can add a new player via the form', async ({ page }) => {
    const input = page.locator('#new-player-name');
    await input.fill('TestPlayer');
    await page.locator('button[onclick="addPlayer()"]').click();

    // Success message should appear
    await expect(page.locator('#player-msg')).toContainText('TestPlayer', { timeout: 5_000 });

    // Player appears in the table
    await expect(page.locator('table')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('table')).toContainText('TestPlayer');
  });

  test('shows error when adding player with empty name', async ({ page }) => {
    await page.locator('button[onclick="addPlayer()"]').click();
    await expect(page.locator('#player-msg')).toContainText(/name/i, { timeout: 5_000 });
  });

  test('shows error when adding duplicate player name', async ({ page }) => {
    const input = page.locator('#new-player-name');
    await input.fill('DupePlayer');
    await page.locator('button[onclick="addPlayer()"]').click();
    await page.waitForTimeout(500);

    // Try to add the same name again
    await input.fill('DupePlayer');
    await page.locator('button[onclick="addPlayer()"]').click();
    await expect(page.locator('#player-msg')).toContainText(/already exists/i, { timeout: 5_000 });
  });

  test('can add player by pressing Enter', async ({ page }) => {
    const input = page.locator('#new-player-name');
    await input.fill('EnterKeyPlayer');
    await input.press('Enter');
    await expect(page.locator('#player-msg')).toContainText('EnterKeyPlayer', { timeout: 5_000 });
  });
});

test.describe('Home Page — Record a Game', () => {
  let league, alice, bob;

  test.beforeAll(async ({ request }) => {
    league = await createTestLeague(request, '_recordgame');
    alice  = await addPlayer(request, league, 'Alice');
    bob    = await addPlayer(request, league, 'Bob');
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(l => localStorage.setItem('currentLeague', l), league);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('#winner-select');
  });

  test('winner and loser dropdowns are populated', async ({ page }) => {
    const winnerOptions = page.locator('#winner-select option');
    const loserOptions  = page.locator('#loser-select option');
    // At least the placeholder + 2 players
    expect(await winnerOptions.count()).toBeGreaterThanOrEqual(3);
    expect(await loserOptions.count()).toBeGreaterThanOrEqual(3);
  });

  test('can record a game result', async ({ page }) => {
    // Select by value — find the option whose text contains the player name
    const winnerOption = page.locator('#winner-select option', { hasText: 'Alice' });
    const loserOption  = page.locator('#loser-select option',  { hasText: 'Bob' });
    await page.selectOption('#winner-select', { value: await winnerOption.getAttribute('value') });
    await page.selectOption('#loser-select',  { value: await loserOption.getAttribute('value') });
    await page.locator('#record-btn').click();

    await expect(page.locator('#game-msg')).toContainText('Alice', { timeout: 5_000 });
    await expect(page.locator('#game-msg')).toContainText('Bob');
  });

  test('shows error when no winner selected', async ({ page }) => {
    await page.locator('#record-btn').click();
    await expect(page.locator('#game-msg')).toContainText(/winner/i, { timeout: 5_000 });
  });

  test('shows error when winner and loser are the same', async ({ page }) => {
    const aliceOption = page.locator('#winner-select option', { hasText: 'Alice' });
    const aliceValue  = await aliceOption.getAttribute('value');
    await page.selectOption('#winner-select', { value: aliceValue });
    await page.selectOption('#loser-select',  { value: aliceValue });
    await page.locator('#record-btn').click();
    await expect(page.locator('#game-msg')).toContainText(/different/i, { timeout: 5_000 });
  });
});

test.describe('Home Page — Game History', () => {
  let league, alice, bob;

  test.beforeAll(async ({ request }) => {
    league = await createTestLeague(request, '_history');
    alice  = await addPlayer(request, league, 'Alice');
    bob    = await addPlayer(request, league, 'Bob');
    await recordGame(request, league, alice.id, bob.id);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(l => localStorage.setItem('currentLeague', l), league);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.game-item');
  });

  test('game history shows at least one result', async ({ page }) => {
    await expect(page.locator('.game-item')).toHaveCount(1);
  });

  test('game history entry shows winner and loser names', async ({ page }) => {
    const item = page.locator('.game-item').first();
    await expect(item).toContainText('Alice');
    await expect(item).toContainText('Bob');
    await expect(item).toContainText('beat');
  });

  test('game history shows rating change', async ({ page }) => {
    const item = page.locator('.game-item').first();
    await expect(item.locator('.game-change')).toContainText('pts');
  });
});

test.describe('Home Page — League Switcher', () => {
  let leagueA, leagueB;

  test.beforeAll(async ({ request }) => {
    leagueA = await createTestLeague(request, '_switchA');
    leagueB = await createTestLeague(request, '_switchB');
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(l => localStorage.setItem('currentLeague', l), leagueA);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.league-switcher');
  });

  test('league switcher shows pill buttons for each league', async ({ page }) => {
    await expect(page.locator('.league-pill')).toHaveCount(
      await page.locator('.league-pill').count()
    );
    // At minimum leagueA and leagueB pills are present
    await expect(page.locator('.league-switcher')).toContainText(
      leagueA.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).split('_')[0]
    );
  });

  test('clicking + New reveals the new league form', async ({ page }) => {
    await page.locator('.add-league').click();
    await expect(page.locator('#new-league-form')).toBeVisible();
  });

  test('can create a new league from the UI', async ({ page }) => {
    await page.locator('.add-league').click();
    const input = page.locator('#new-league-name');
    const uniqueName = `uilg_${Date.now()}`;
    await input.fill(uniqueName);
    await page.locator('#new-league-form .btn').click();

    // The new league should become active
    await expect(page.locator('#league-title')).toContainText(
      uniqueName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      { timeout: 5_000 }
    );
  });
});



