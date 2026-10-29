import { expect, test } from './network';
import { seedCheckout } from './setup';

test('focused address clear control removes its quote and disables Continue', async ({
  page,
}) => {
  await seedCheckout(page, { startAtContact: true });
  await page.route('**/api/places/autocomplete?**', (route) =>
    route.fulfill({
      json: {
        predictions: [
          {
            provider: 'geoapify',
            placeId: 'geoapify:address-clear-fixture',
            mainText: '12 Broad Street',
            secondaryText: 'Lagos Island, Lagos',
            fullText: '12 Broad Street, Lagos Island, Lagos',
            details: {
              formattedAddress: '12 Broad Street, Lagos Island, Lagos',
              city: 'Lagos Island',
              state: 'Lagos',
              country: 'Nigeria',
              location: { latitude: 6.454, longitude: 3.393 },
            },
          },
        ],
      },
    })
  );
  const cartValidation = page.waitForResponse('**/api/cart/validate');
  await page.goto('/checkout?qa=manual-address-clear');
  await (await cartValidation).finished();
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();

  const address = page.getByRole('textbox', { name: /Delivery Address/ });
  const quoteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/shipping/quotes') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().receiver.latitude === 6.454
  );
  await address.fill('12 Broad Street, Lagos Island, Lagos');
  await page
    .getByRole('button', { name: /12 Broad Street.*Lagos Island/ })
    .click();
  expect((await quoteResponse).status()).toBe(200);
  await expect(
    page.getByText('GIG Logistics - Standard', { exact: true })
  ).toBeVisible();

  const continueButton = page.getByRole('button', {
    name: 'Continue to Payment',
  });
  await expect(continueButton).toBeEnabled();

  await page
    .getByRole('button', { name: 'Clear address', exact: true })
    .click();
  await expect(address).toHaveValue('');
  await expect(
    page.getByText('GIG Logistics - Standard', { exact: true })
  ).toHaveCount(0);
  await expect(continueButton).toBeDisabled();

  const refreshedQuoteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/shipping/quotes') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().receiver.latitude === 6.454
  );
  await address.fill('12 Broad Street, Lagos Island, Lagos');
  await page
    .getByRole('button', { name: /12 Broad Street.*Lagos Island/ })
    .click();
  expect((await refreshedQuoteResponse).status()).toBe(200);
  await expect(
    page.getByText('GIG Logistics - Standard', { exact: true })
  ).toBeVisible();
  await expect(continueButton).toBeEnabled();
});
