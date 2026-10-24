import { expect, test } from './network';

test('books a catalog device with a quoted pickup through payment handoff', async ({
  page,
}) => {
  const localOrigin = `http://127.0.0.1:${process.env.CHECKOUT_BROWSER_PORT?.trim() || '3217'}`;
  const externalRequests: string[] = [];
  const deviceSearchRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/repairs/devices')) {
      deviceSearchRequests.push(url.pathname + url.search);
    }
    if (url.origin !== localOrigin) {
      externalRequests.push(`${route.request().method()} ${url.origin}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.goto('/repair');
  await page.waitForLoadState('networkidle');
  const deviceModel = page.getByLabel('Device Model');
  await deviceModel.fill('iPhone 15');
  await expect(deviceModel).toHaveValue('iPhone 15');
  const suggestion = page.getByRole('option', {
    name: 'Apple iPhone 15 Smartphone',
  });
  const productImage = suggestion.getByRole('img', { name: 'Apple iPhone 15' });
  await expect(productImage).toBeVisible();
  await expect
    .poll(() =>
      productImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  await page
    .getByRole('option', { name: 'Apple iPhone 15 Smartphone' })
    .click();
  await expect(page.getByLabel('Device Model')).toHaveValue('Apple iPhone 15');
  await expect(page.getByText('Choose a device')).toHaveCount(0);
  await page
    .getByLabel("What's the issue?")
    .fill('Cracked screen needs repair');
  await page.getByRole('button', { name: /^next$/i }).click();

  await page.getByLabel('Full Name').fill('Ada Lovelace');
  await page.getByLabel('Phone Number').fill('+2348012345678');
  await page.getByLabel('Email Address').fill('ada@example.test');
  await page.getByText('Pickup', { exact: true }).click();
  await expect(
    page.getByText(
      /select an address suggestion to calculate the GIG Logistics pickup fee/i
    )
  ).toBeVisible();
  const address = page.getByLabel('Pickup Address');
  await address.fill('12 Station Road, Osogbo');
  await page.getByRole('button', { name: /12 station road/i }).click();
  await expect(page.getByText('Estimated pickup fee: ₦2,500')).toBeVisible();

  await page.getByRole('button', { name: /^next$/i }).click();
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(page.getByText('₦2,500', { exact: true })).toBeVisible();
  expect(deviceSearchRequests).toEqual([
    '/api/storefront/ogabassey/repairs/devices?q=iPhone%2015&mode=suggestions',
  ]);
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  await expect(
    page.getByRole('heading', { name: 'Pay for courier pickup' })
  ).toBeVisible();
  await expect(page.getByText('Ticket #7421')).toBeVisible();
  await expect(page.getByText('GIG Logistics pickup fee')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Pay securely with Paystack' })
  ).toHaveAttribute(
    'href',
    'https://checkout.paystack.com/local-fixture-not-valid'
  );
  expect(externalRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
