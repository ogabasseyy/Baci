import { expect, test } from './network';
import { seedCheckout } from './setup';

test.use({
  allowedConsoleErrors: Array(4).fill(
    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
  ),
});

for (const width of [390, 1440]) {
  test(`manual street and locality keep verified Store Pickup usable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seedCheckout(page, { startAtContact: true });
    await page.route('**/api/places/autocomplete?**', (route) =>
      route.fulfill({
        status: 503,
        json: {
          code: 'PLACES_AUTOCOMPLETE_BUDGET_UNAVAILABLE',
          error: 'Unavailable',
        },
      })
    );
    let rateLookupWorks = false;
    const manualBodies: Array<{
      merchant_rates_only?: boolean;
      receiver: { latitude?: number };
    }> = [];
    await page.route('**/api/shipping/quotes', (route) => {
      manualBodies.push(route.request().postDataJSON());
      return route.fulfill(
        rateLookupWorks
          ? {
              json: { quotes: { all: [], featured: [] } },
            }
          : {
              status: 503,
              json: { error: 'Please retry the store rate lookup.' },
            }
      );
    });
    const cart = page.waitForResponse('**/api/cart/validate');
    await page.goto('/checkout');
    await (await cart).finished();
    await page.getByRole('button', { name: 'Continue to Delivery' }).click();
    await page.getByLabel('City / Town').fill('');
    await page.getByLabel('State', { exact: true }).selectOption('');
    await page.getByLabel('Delivery Address').fill('12 Sample Estate Ogombo');
    await expect(
      page.getByText(/Address suggestions are unavailable/)
    ).toBeVisible();
    const next = page.getByRole('button', { name: 'Continue to Payment' });
    await expect(next).toBeDisabled();
    await page.getByLabel('City / Town').fill('Ogombo');
    await page.getByLabel('State', { exact: true }).selectOption('Lagos');
    await page
      .getByRole('button', { name: /Store Pickup.*Collect at store/ })
      .click();
    await expect(next).toBeDisabled();
    await expect(
      page.getByText('Refresh pickup availability to continue.')
    ).toBeVisible();
    const retry = page.getByRole('button', {
      name: 'Refresh pickup availability',
    });
    await expect(retry).toBeEnabled();
    rateLookupWorks = true;
    await retry.click();
    await expect(next).toBeEnabled();
    expect(manualBodies.length).toBeGreaterThan(0);
    for (const body of manualBodies) {
      expect(body.merchant_rates_only).toBe(true);
      expect(body.receiver.latitude).toBeUndefined();
    }
    await page.screenshot({
      path: testInfo.outputPath(`manual-pickup-${width}.png`),
      fullPage: true,
    });
    await next.click();
    await expect(
      page.getByRole('heading', { name: 'Payment Method' })
    ).toBeVisible();
    await expect(page.getByLabel('Delivery Address')).toBeHidden();
    await expect(
      page.getByRole('radio', { name: /Paystack Popular/ })
    ).toBeVisible();
  });
}

test('a restored payment step cannot submit pickup while its rate check fails', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedCheckout(page);
  await page.route('**/api/shipping/quotes', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Store rates unavailable. Retry.' },
    })
  );
  await page.goto('/checkout');
  await page.getByRole('radio', { name: /Paystack Popular/ }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('radio', { name: /Paystack Popular/ })
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Place Order', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Delivery Method', exact: true })
    .click();
  await expect(
    page.getByText('Refresh pickup availability to continue.')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh pickup availability' })
  ).toBeEnabled();
});
