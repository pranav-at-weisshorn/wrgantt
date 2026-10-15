import { defineConfig } from '@playwright/test';

// Node globals without pulling @types/node into the browser tsconfig.
declare const process: { env: Record<string, string | undefined> };

const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Uses the installed Microsoft Edge, so no browser download is needed.
    // Set PW_CHANNEL=chromium (after `npx playwright install chromium`) to use bundled Chromium.
    channel:
      process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL ?? 'msedge'),
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
