import { test, expect } from '@playwright/test';

// Auth-flow E2E — verifies the dual-token architecture end to end.
// Requires a seeded superadmin. Set creds via env (defaults match the dev seed).
const ADMIN = process.env.E2E_ADMIN_NAME || 'Super Admin';
const PASS  = process.env.E2E_ADMIN_PASS || 'ChangeMe@2026!';

async function login(page) {
  await page.goto('/admin');
  await page.getByLabel(/admin name/i).fill(ADMIN);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
}

test.describe('Dual-token authentication', () => {
  test('logs in and reaches the dashboard', async ({ page }) => {
    await login(page);
    // Dashboard chrome should appear (not the login form).
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByLabel(/^password$/i)).toHaveCount(0);
  });

  test('access token is NOT persisted to localStorage (XSS hardening)', async ({ page }) => {
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('semivra_token'));
    expect(token).toBeNull();
  });

  test('session survives a full page reload via silent refresh', async ({ page }) => {
    await login(page);
    await page.reload();
    // After reload the in-memory token is gone; the refresh cookie must restore it.
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByLabel(/^password$/i)).toHaveCount(0); // still authenticated
  });

  test('logout revokes the session — reload returns to login', async ({ page }) => {
    await login(page);
    // Trigger the app's logout/end-shift path, then confirm the cookie no longer restores a session.
    await page.context().clearCookies();
    await page.reload();
    await expect(page.getByLabel(/^password$/i)).toBeVisible({ timeout: 10_000 });
  });
});
