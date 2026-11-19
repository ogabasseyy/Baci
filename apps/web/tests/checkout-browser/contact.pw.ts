import { cartItem } from './fixtures';
import { expect, test } from './network';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((item) => {
    localStorage.setItem('baci-cart-ogabassey-guest', JSON.stringify([item]));
  }, cartItem);
  await page.goto('/checkout');
});

test('contact fields have labels, autofill and actionable errors', async ({
  page,
}) => {
  const firstName = page.getByRole('textbox', {
    name: 'First Name *',
    exact: true,
  });
  await expect(firstName).toHaveAttribute('autocomplete', 'given-name');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await expect(firstName).toBeFocused();
  await expect(firstName).toHaveAttribute('aria-invalid', 'true');
  await expect(firstName).toHaveAccessibleDescription('First name is required');
  await firstName.fill('Ada');
  await page
    .getByRole('textbox', { name: 'Last Name *', exact: true })
    .fill('Okon');
  await page
    .getByRole('textbox', { name: 'Email Address *', exact: true })
    .fill('ada@example.test');
  await page
    .getByRole('textbox', { name: 'Phone Number *', exact: true })
    .fill('+2348031234567');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await expect(
    page.getByRole('button', { name: /Delivery Method/ })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(firstName).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: /Delivery Method/ })
  ).toBeFocused();
});

test('guest checkout does not ask for a password', async ({ page }) => {
  await expect(
    page.getByRole('button', { name: /Contact Information/ })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByLabel('Create a Password', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: /Save my information/ })
  ).toHaveCount(0);
});
