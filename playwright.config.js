// @ts-check
const { defineConfig } = require('@playwright/test');

// CI-only tooling for a plain static site with no build step — this
// config exists purely to run tests/, never to build or bundle the game.
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false, // tests share a single served instance's expectations about phase/state
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: 'python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 400, height: 800 },
  },
});
