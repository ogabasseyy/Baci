import { expect, test } from './network';
import { seedCheckout } from './setup';

test.describe('address-provider outage', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    allowedConsoleErrors: [
      'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
    ],
  });

  test('accepts manual locality, explains the missing pin, and keeps Store Pickup usable', async ({
    page,
  }, testInfo) => {
    await page.route('**/api/places/autocomplete?**', (route) =>
      route.fulfill({
        status: 503,
        json: {
          code: 'PLACES_AUTOCOMPLETE_BUDGET_UNAVAILABLE',
          error: 'Address suggestions unavailable',
        },
      })
    );
    await seedCheckout(page, { startAtContact: true });
    await page.goto('/checkout');
    await page.getByRole('button', { name: 'Continue to Delivery' }).click();
    await page
      .getByRole('textbox', { name: 'Delivery Address' })
      .fill('12 Sample Estate Ogombo');
    await expect(
      page.getByText(/Address suggestions are unavailable/)
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'City / Town' }).fill('Ogombo');
    await page.getByRole('combobox', { name: 'State' }).selectOption('Lagos');
    await expect(
      page.getByRole('textbox', { name: 'Delivery Address' })
    ).toHaveValue('12 Sample Estate Ogombo');
    await expect(
      page.getByText(/Confirm location for GIG delivery/)
    ).toBeVisible();
    const proceed = page.getByRole('button', { name: 'Continue to Payment' });
    await expect(proceed).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('manual-address.png'),
      fullPage: true,
    });

    await page
      .getByRole('button', { name: /Store Pickup.*Collect at store/ })
      .click();
    await expect(proceed).toBeEnabled();
    await proceed.click();
    await expect(page.getByRole('radio', { name: /paystack/i })).toBeVisible();
    // Stop before order creation or payment.
  });
});

test('distinguishes coverage failure from unsupported delivery and clears a stale quote on manual edits', async ({
  page,
}, testInfo) => {
  await seedCheckout(page, { startAtContact: true });
  await page.route('**/api/places/autocomplete?**', (route) =>
    route.fulfill({
      json: {
        predictions: [
          {
            provider: 'geoapify',
            placeId: 'geoapify:fixture-address',
            mainText: '12 Sample Estate',
            secondaryText: 'Ogombo, Lagos',
            fullText: '12 Sample Estate, Ogombo, Lagos',
            details: {
              formattedAddress: '12 Sample Estate, Ogombo, Lagos',
              city: 'Ogombo',
              state: 'Lagos',
              country: 'Nigeria',
              location: { latitude: 6.4654, longitude: 3.4064 },
            },
          },
        ],
      },
    })
  );
  let quoteRequests = 0;
  await page.route('**/api/shipping/quotes', (route) => {
    quoteRequests += 1;
    return route.fulfill({
      json: {
        quotes: [
          {
            id: 'pickup-fixture',
            provider: 'GIGL',
            serviceTier: 'Station Pickup - GoStandard',
            carrierName: 'GIG Logistics',
            displayName: 'GIG Logistics - Fixture station',
            estimatedDays: 2,
            price: 3000,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            isStationPickup: true,
            stationAddress: 'Synthetic collection point',
            homeDeliveryCoverage: 'unavailable',
          },
        ],
      },
    });
  });
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await page
    .getByRole('textbox', { name: 'Delivery Address' })
    .fill('12 Sample Estate');
  await page.getByRole('button', { name: /12 Sample Estate.*Ogombo/ }).click();
  await expect(
    page.getByText('Home delivery could not be confirmed.')
  ).toBeVisible();
  const beforeRetry = quoteRequests;
  await page.getByRole('button', { name: 'Retry home delivery' }).click();
  await expect.poll(() => quoteRequests).toBeGreaterThan(beforeRetry);
  await expect(
    page.getByText(
      "GIGL doesn't currently support door delivery to this location."
    )
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('coverage-unavailable.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Choose Pickup Stations (GIGL)' })
    .click();
  const proceed = page.getByRole('button', { name: 'Continue to Payment' });
  await expect(proceed).toBeEnabled();
  await page.getByRole('textbox', { name: 'City / Town' }).fill('Epe');
  await expect(proceed).toBeDisabled();
  await expect(
    page.getByText(/Confirm location for GIG delivery/)
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Geoapify', exact: true }).last()
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /OpenStreetMap/ }).last()
  ).toBeVisible();
});
