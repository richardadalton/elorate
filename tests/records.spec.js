/**
 * UI tests — Records page (records.html)
 */

const { test, expect } = require('@playwright/test');
const { BASE, createTestLeague, addPlayer, recordGame } = require('./helpers');

let league, alice, bob;

test.beforeAll(async ({ request }) => {
  league = await createTestLeague(request, '_recordspage');
  alice  = await addPlayer(request, league, 'Alice');
  bob    = await addPlayer(request, league, 'Bob');

  // Alice wins 3 in a row → holds longest win streak, most wins, highest ELO
  await recordGame(request, league, alice.id, bob.id);
  await recordGame(request, league, alice.id, bob.id);
  await recordGame(request, league, alice.id, bob.id);
});

async function gotoRecords(page) {
  if (!league) throw new Error('league not set — beforeAll may not have completed');
  // Navigate directly using ?league= — records.js reads it from URL params
  await page.goto(`${BASE}/records.html?league=${league}`, { waitUntil: 'networkidle', timeout: 30_000 });
  // Wait for the records grid to be present in the DOM
  await page.waitForSelector('.records-grid', { timeout: 15_000 });
  // Poll until the Longest Winning Streak card shows a real value (Alice wins 3 in beforeAll).
  await page.waitForFunction(
    () => {
      const card = Array.from(document.querySelectorAll('.record-card'))
        .find(c => c.textContent.includes('Longest Winning Streak'));
      if (!card) return false;
      const val = card.querySelector('.record-value');
      return val && val.textContent.trim() !== '—';
    },
    { timeout: 20_000 }
  );
}

test.describe('Records Page — Layout', () => {
  test('page heading is visible', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('h1')).toContainText('Records');
  });

  test('back link navigates to home', async ({ page }) => {
    await gotoRecords(page);
    const backLink = page.locator('.back-link');
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', /\//);
  });

  test('shows seven record cards', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card')).toHaveCount(7);
  });
});

test.describe('Records Page — Content', () => {
  test('Longest Winning Streak card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Longest Winning Streak' })).toBeVisible();
  });

  test('Longest Active Streak card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Longest Active Streak' })).toBeVisible();
  });

  test('Alice is shown as active streak holder (she won the last game)', async ({ page }) => {
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Longest Active Streak' });
    await expect(card).toContainText('Alice');
  });

  test('Most Games Played card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Most Games Played' })).toBeVisible();
  });

  test('Most Games Won card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Most Games Won' })).toBeVisible();
  });

  test('Highest Ever ELO card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Highest Ever ELO' })).toBeVisible();
  });

  test('Biggest Upset card is shown', async ({ page }) => {
    await gotoRecords(page);
    await expect(page.locator('.record-card', { hasText: 'Biggest Upset' })).toBeVisible();
  });

  test('Alice is shown as record holder for longest win streak', async ({ page }) => {
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Longest Winning Streak' });
    await expect(card).toContainText('Alice');
    await expect(card).toContainText('3');
  });

  test('Alice is shown as record holder for most wins', async ({ page }) => {
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Most Games Won' });
    await expect(card).toContainText('Alice');
  });

  test('Alice is shown as record holder for highest ELO', async ({ page }) => {
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Highest Ever ELO' });
    await expect(card).toContainText('Alice');
  });

  test('record holder name is a link to their profile page', async ({ page }) => {
    await gotoRecords(page);
    // Scope to the Longest Winning Streak card where Alice is guaranteed to be the sole holder
    const card = page.locator('.record-card', { hasText: 'Longest Winning Streak' });
    const link = card.locator('.player-link').first();
    await expect(link).toHaveAttribute('href', /player\.html/);
  });

  test('clicking record holder link navigates to player profile', async ({ page }) => {
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Longest Winning Streak' });
    const link = card.locator('.player-link', { hasText: 'Alice' });
    await link.click();
    await page.waitForSelector('.hero', { timeout: 10_000 });
    await expect(page.locator('.hero-name')).toContainText('Alice');
  });

  test('Biggest Upset card shows — when no upset has occurred', async ({ page }) => {
    // In this league Alice beat Bob 3 times from equal ratings — diff is always 0
    await gotoRecords(page);
    const card = page.locator('.record-card', { hasText: 'Biggest Upset' });
    await expect(card.locator('.record-value')).toContainText('—');
  });

  test('Biggest Upset card shows winner and loser names when an upset has occurred', async ({ request, page }) => {
    const ul = await createTestLeague(request, '_upsetui');
    const ua = await addPlayer(request, ul, 'Underdog');
    const ub = await addPlayer(request, ul, 'Favourite');
    // Build Favourite's rating up
    await recordGame(request, ul, ub.id, ua.id);
    await recordGame(request, ul, ub.id, ua.id);
    await recordGame(request, ul, ub.id, ua.id);
    // Now Underdog beats Favourite — an upset
    await recordGame(request, ul, ua.id, ub.id);

    await page.goto(`${BASE}/records.html?league=${ul}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.records-grid', { timeout: 10_000 });

    const card = page.locator('.record-card', { hasText: 'Biggest Upset' });
    await expect(card).toContainText('Underdog');
    await expect(card).toContainText('Favourite');
    await expect(card.locator('.record-value')).not.toContainText('—');
  });

  test('Biggest Upset winner name is a link to their profile', async ({ request, page }) => {
    const ul = await createTestLeague(request, '_upsetlink');
    const ua = await addPlayer(request, ul, 'Underdog');
    const ub = await addPlayer(request, ul, 'Favourite');
    await recordGame(request, ul, ub.id, ua.id);
    await recordGame(request, ul, ub.id, ua.id);
    await recordGame(request, ul, ua.id, ub.id);

    await page.goto(`${BASE}/records.html?league=${ul}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.records-grid', { timeout: 10_000 });

    const card = page.locator('.record-card', { hasText: 'Biggest Upset' });
    const link = card.locator('.player-link', { hasText: 'Underdog' });
    await expect(link).toHaveAttribute('href', /player\.html/);
  });
});

test.describe('Records Page — Empty state', () => {
  test('shows dashes for streak/wins when no games have been played', async ({ request, page }) => {
    const emptyLeague = await createTestLeague(request, '_emptyrecords');
    await addPlayer(request, emptyLeague, 'Solo');

    await page.goto(`${BASE}/records.html?league=${emptyLeague}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.records-grid', { timeout: 10_000 });

    // Longest Win Streak — no games, should show '—'
    const streakCard = page.locator('.record-card', { hasText: 'Longest Winning Streak' });
    await expect(streakCard.locator('.record-value')).toContainText('—');

    // Most Games Won — 0 wins, should show '—'
    const winsCard = page.locator('.record-card', { hasText: 'Most Games Won' });
    await expect(winsCard.locator('.record-value')).toContainText('—');
  });

  test('shows no-record placeholder when no player holds a record', async ({ request, page }) => {
    const emptyLeague = await createTestLeague(request, '_emptyrecords2');

    await page.goto(`${BASE}/records.html?league=${emptyLeague}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.records-grid', { timeout: 10_000 });

    // No players at all — all values should be '—'
    const values = await page.locator('.record-value').allTextContents();
    expect(values.every(v => v.trim() === '—')).toBe(true);
  });
});


