import { test, expect } from '@playwright/test';

// Auth-flow E2E — verifies the dual-token system end to end.
// Requires the backend running against a TEST db with a seeded Super Admin whose
// password matches E2E_ADMIN_PASS (defaults to the dev seed password).
const ADMIN = process.env.E2E_ADMIN_NAME || 'Super Admin';
const PASS  = process.env.E2E_ADMIN_PASS || 'ChangeMe@2026!';

// The login form is gone once authenticated → use that as the "logged in" signal.
const loginVisible = (page) => page.getByLabel('Password', { exact: true });

async function login(page) {
  await page.goto('/admin');
  await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 30000 });
  await page.getByLabel('Staff Name').fill(ADMIN);
  await page.getByLabel('Password', { exact: true }).fill(PASS);
  await page.locator('form button[type="submit"]').click();
  // Generous timeout: the first login of a run is slow (cold dev-server compile + cold backend).
  await expect(loginVisible(page)).toHaveCount(0, { timeout: 30000 }); // dashboard reached
}

test.describe('Dual-token authentication', () => {
  test('logs in and reaches the dashboard', async ({ page }) => {
    await login(page);
  });

  test('access token is NOT persisted to localStorage', async ({ page }) => {
    await login(page);
    const leaked = await page.evaluate(() => localStorage.getItem('semivra_token') || localStorage.getItem('kasa_token'));
    expect(leaked).toBeNull();
  });

  test('session survives a single reload (silent refresh)', async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 15000 });
    await expect(loginVisible(page)).toHaveCount(0);
  });

  test('spamming reload does NOT log the user out', async ({ page }) => {
    await login(page);
    for (let i = 0; i < 6; i++) await page.reload();
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 15000 });
    await expect(loginVisible(page)).toHaveCount(0); // still authenticated
  });

  test('clearing the refresh cookie forces re-login', async ({ page }) => {
    await login(page);
    await page.context().clearCookies();
    await page.reload();
    await expect(loginVisible(page)).toBeVisible({ timeout: 15000 });
  });
});
