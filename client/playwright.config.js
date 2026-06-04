import { defineConfig, devices } from '@playwright/test';

// E2E config for the Semivra POS frontend.
// Prereqs to run locally:
//   1. Backend running (server/) against a TEST MongoDB — never a production DB.
//   2. Frontend dev server running (npm run dev), or set E2E_BASE_URL.
//   3. `npx playwright install chromium` once to fetch the browser binary.
// Run: `npm run e2e`  (or `npm run e2e:ui` for the interactive runner).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,           // POS flows mutate shared server state — keep serial
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Tablet viewport — the primary POS target.
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'] } },
  ],
});
