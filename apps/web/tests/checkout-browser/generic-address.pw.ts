import type { Page } from '@playwright/test';
import { merchant, shippingQuoteId } from './fixtures';
import { expect, test } from './network';
import { seedCheckout } from './setup';

const pin = { latitude: 6.454, longitude: 3.393 };
const prediction = {
  placeId: 'generic-fixture',
  mainText: '12 Broad Street',
  secondaryText: 'Lagos Island, Lagos',
  fullText: '12 Broad Street, Lagos Island, Lagos',
};
const details = {
  placeId: prediction.placeId,
  formattedAddress: prediction.fullText,
  city: 'Lagos Island',
  state: 'Lagos',
  country: 'Nigeria',
  location: pin,
};

async function setup(page: Page) {
  await seedCheckout(page, { startAtContact: true });
  await page.route('**/grid.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    })
  );
  await page.route('http://127.0.0.1:54329/rest/v1/merchants?**', (route) =>
    route.fulfill({ json: merchant })
  );
  await page.route('http://127.0.0.1:54329/rest/v1/domains?**', (route) =>
    route.fulfill({ json: null })
  );
  await page.route('**/api/storefront/features?**', (route) =>
    route.fulfill({ json: { paystackEnabled: true, korapayEnabled: false } })
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({ json: { success: true } })
  );
  await page.route('**/api/analytics/events', (route) =>
    route.fulfill({ json: { success: true } })
  );
  await page.route('**/api/analytics/ga4', (route) =>
    route.fulfill({ json: { success: true } })
  );
  await page.goto('/checkout-generic');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('textbox', { name: 'First Name' }).fill('Test');
  await page
    .getByRole('textbox', { name: 'Last Name (Surname)' })
    .fill('Buyer');
  await page
    .getByRole('textbox', { name: 'Email' })
    .fill('fixture@example.test');
  await page
    .getByRole('textbox', { name: 'Phone Number' })
    .fill('+2348031234567');
}

function quote(provider: 'GIGL' | 'MERCHANT') {
  return {
    id: shippingQuoteId,
    provider,
    carrierName: provider === 'GIGL' ? 'GIG Logistics' : 'Store delivery',
    serviceTier: 'Standard',
    displayName: provider === 'GIGL' ? 'GIG Logistics' : 'Store delivery',
    pickupIncluded: false,
    insuranceIncluded: false,
    price: 1000,
    currency: 'NGN',
    estimatedDays: 2,
    isStationPickup: false,
    shippingRateId: provider === 'MERCHANT' ? shippingQuoteId : undefined,
  };
}

for (const width of [390, 1440]) {
  test(`shared checkout preserves a selected pin and clears it after a city edit at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/places/autocomplete?**', (route) =>
      route.fulfill({ json: { predictions: [prediction] } })
    );
    await page.route('**/api/places/details?**', (route) =>
      route.fulfill({ json: { details } })
    );
    await page.route('**/api/shipping/quotes', (route) => {
      const receiver = route.request().postDataJSON().receiver;
      requests.push(receiver);
      return route.fulfill({
        json: {
          quotes:
            receiver.latitude === pin.latitude &&
            receiver.longitude === pin.longitude
              ? [quote('GIGL')]
              : [],
          sessionId: 'fixture-session',
        },
      });
    });
    await setup(page);
    await page
      .getByRole('textbox', { name: 'Delivery Address' })
      .fill('12 Broad');
    await page
      .getByRole('button', { name: /12 Broad Street.*Lagos Island/ })
      .click();
    await expect(
      page.getByText('GIG Logistics', { exact: true })
    ).toBeVisible();
    expect(requests.at(-1)).toMatchObject({
      ...pin,
      city: 'Lagos Island',
      state: 'Lagos',
    });
    await page.screenshot({
      path: testInfo.outputPath('shared-courier-selected.png'),
      fullPage: true,
    });
    await page.getByRole('textbox', { name: 'City' }).fill('Ikeja');
    await expect(page.getByText('GIG Logistics', { exact: true })).toHaveCount(
      0
    );
    await expect(
      page.getByText(/Select an address suggestion to confirm the location/)
    ).toBeVisible();
    expect(requests.at(-1)).toMatchObject({ city: 'Ikeja' });
    expect(requests.at(-1)).not.toHaveProperty('latitude');
    await expect(
      page.getByRole('button', { name: 'Continue to Payment' })
    ).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'City' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('shared-pin-required.png'),
      fullPage: true,
    });
  });

  test(`shared manual address remains usable with a merchant rate at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/shipping/quotes', (route) => {
      expect(route.request().postDataJSON().receiver).not.toHaveProperty(
        'latitude'
      );
      return route.fulfill({
        json: { quotes: [quote('MERCHANT')], sessionId: 'fixture-session' },
      });
    });
    await setup(page);
    await page
      .getByRole('textbox', { name: 'Delivery Address' })
      .fill('Good news estate ogombo');
    await page.getByRole('textbox', { name: 'City' }).fill('Ogombo');
    await page.getByRole('textbox', { name: 'State' }).fill('Lagos');
    await expect(
      page.getByText('Store delivery', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    await expect(page.getByText('Paystack', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('shared-manual-payment.png'),
      fullPage: true,
    });
  });
}
