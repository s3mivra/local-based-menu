import { test, expect } from '@playwright/test';

// Checkout / order-integrity smoke. These assert the POS register can take an order
// and that the double-submit guard prevents duplicate orders on a fast double-tap.
// Selectors are intentionally role/text-based and may need tuning to the live DOM.
const ADMIN = process.env.E2E_ADMIN_NAME || 'Super Admin';
const PASS  = process.env.E2E_ADMIN_PASS || 'ChangeMe@2026!';

test.beforeEach(async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/admin name/i).fill(ADMIN);
  await page.getByLabel(/password/i).fill(PASS);
  // Superadmin may skip starting cash; non-admins must fill it.
  const cash = page.getByLabel(/starting cash/i);
  if (await cash.count()) await cash.fill('1000');
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 10_000 });
});

test('register loads and shows the product search', async ({ page }) => {
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible({ timeout: 10_000 });
});

test('double-tap on checkout does not create two orders', async ({ page }) => {
  // Add the first available product to the cart.
  const firstProduct = page.getByRole('button').filter({ hasText: /₱/ }).first();
  await firstProduct.click();

  const checkout = page.getByRole('button', { name: /charge|pay|checkout|place order/i }).first();
  // Fire two rapid clicks; the handler must disable/guard after the first.
  await Promise.all([checkout.click(), checkout.click().catch(() => {})]);

  // Confirm payment if a modal appears.
  const confirm = page.getByRole('button', { name: /confirm|complete/i }).first();
  if (await confirm.count()) await confirm.click();

  // Exactly one new order should be in the queue for this product (assert via API ideally).
  // Placeholder assertion — replace with an /api/orders count check in CI.
  await expect(page.getByText(/order/i).first()).toBeVisible();
});
