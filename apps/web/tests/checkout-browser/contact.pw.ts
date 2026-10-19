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

test('collapsed contact and password controls stay out of keyboard navigation', async ({
  page,
}) => {
  const contactHeader = page.getByRole('button', {
    name: /Contact Information/,
  });
  await expect(contactHeader).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByLabel('Create a Password', { exact: true })
  ).not.toBeVisible();
  await page.getByRole('checkbox', { name: /Save my information/ }).check();
  const password = page.getByLabel('Create a Password', { exact: true });
  await expect(password).toBeVisible();
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await page.getByRole('checkbox', { name: /Save my information/ }).uncheck();
  await expect(password).not.toBeVisible();
});
