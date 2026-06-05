import { test, expect } from '@playwright/test';

// Lightweight smoke test — confirms the app loads and the dashboard renders after
// login without console errors. Catches the "white screen / broken build" class of bug.
const ADMIN = process.env.E2E_ADMIN_NAME || 'Super Admin';
const PASS  = process.env.E2E_ADMIN_PASS || 'ChangeMe@2026!';

test('app loads the login screen', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByLabel('Staff Name')).toBeVisible({ timeout: 15000 });
});

test('dashboard renders after login with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/admin');
  await page.getByLabel('Staff Name').fill(ADMIN);
  await page.getByLabel('Password', { exact: true }).fill(PASS);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0, { timeout: 30000 });

  // Ignore benign network noise; fail on real runtime errors.
  const real = errors.filter(e => !/favicon|manifest|service ?worker|net::ERR|Failed to load resource/i.test(e));
  expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
});
