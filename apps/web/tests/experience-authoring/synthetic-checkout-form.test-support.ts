import type { Page } from 'playwright-core';

export async function fillSyntheticStorefrontCheckout(page: Page) {
  await page.waitForURL(/\/synthetic\/checkout(?:\?|$)/, { timeout: 120000 });
  await page.locator('input[name="firstName"]').waitFor({ timeout: 120000 });
  const necessaryOnly = page.getByRole('button', { name: 'Necessary Only' });
  if (await necessaryOnly.isVisible()) await necessaryOnly.click();
  await page.locator('input[name="firstName"]').fill('Synthetic');
  await page.locator('input[name="lastName"]').fill('Buyer');
  await page
    .locator('input[name="customerEmail"]')
    .fill('buyer@example.invalid');
  await page.locator('input[name="customerPhone"]').fill('08012345678');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page.locator('#checkout-delivery-address').fill('123 Test Street');
  await page.locator('#checkout-delivery-city').fill('Los Angeles');
  const state = page.locator('#checkout-delivery-state');
  if ((await state.evaluate((element) => element.tagName)) === 'SELECT')
    await state.selectOption({ label: 'California' });
  else await state.fill('California');
  await page.getByText('Synthetic delivery').waitFor({ timeout: 90000 });
  await page.getByText('Synthetic delivery').click();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();
  await page
    .getByRole('button', { name: /Place Order/i })
    .first()
    .waitFor({ timeout: 90000 });
}
