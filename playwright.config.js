// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,   // tests share a live server — run serially to avoid race conditions
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },

  // Spin up a separate test server on port 3001 so it doesn't clash with dev
  webServer: {
    command: 'rm -rf /tmp/pool_league_test_data_v2 && TEST_PORT=3001 TEST_DATA_DIR=/tmp/pool_league_test_data_v2 node index.js',
    port: 3001,
    reuseExistingServer: false,
    timeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});


