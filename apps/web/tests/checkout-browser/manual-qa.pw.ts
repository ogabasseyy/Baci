import { waitForSuccessfulCartValidation } from './cart-validation';
import { expect, test } from './network';
import { seedCheckout } from './setup';

test('manual QA scenario controls are opt-in and reset local checkout state', async ({
  page,
}) => {
  await seedCheckout(page);

  const storefrontValidation = waitForSuccessfulCartValidation(page);
  await page.goto('/checkout');
  await storefrontValidation;
  await expect(
    page.getByRole('complementary', { name: 'Manual checkout QA fixtures' })
  ).toHaveCount(0);

  const initialManualValidation = waitForSuccessfulCartValidation(page);
  await page.goto('/checkout?qa=manual');
  const controls = page.getByRole('complementary', {
    name: 'Manual checkout QA fixtures',
  });
  await expect(controls).toBeVisible();
  await initialManualValidation;

  // Selecting a scenario updates the cookie and reloads the fixture page.
  const scenarioReload = page.waitForEvent('load');
  const reloadedManualValidation = waitForSuccessfulCartValidation(page);
  await controls.getByLabel('Payment scenario').selectOption('provider-error');
  await Promise.all([scenarioReload, reloadedManualValidation]);
  await expect(controls.getByLabel('Payment scenario')).toHaveValue(
    'provider-error'
  );

  await page.evaluate(() =>
    localStorage.setItem(
      'storefront-checkout-idempotency',
      'fixture-idempotency'
    )
  );
  await page.evaluate(() =>
    sessionStorage.setItem(
      'storefront-checkout-pending-order',
      JSON.stringify({
        orderId: '44444444-4444-4444-8444-444444444444',
        trackingToken: 'fixture-tracking-token',
        merchantId: '11111111-1111-4111-8111-111111111111',
        customerEmail: 'ada@example.test',
        customerPhone: '+2348031234567',
        checkoutFingerprint: 'fixture-fingerprint',
        amountDueToGateway: 107500,
        createdAt: new Date().toISOString(),
      })
    )
  );
  await controls
    .getByRole('button', { name: 'Reset checkout fixtures' })
    .click();
  await expect(page).toHaveURL(/\/cart\?qa=manual$/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        cartItems: JSON.parse(
          localStorage.getItem('baci-cart-ogabassey-guest') || '[]'
        ).length,
        form: sessionStorage.getItem('checkout-form'),
        pendingOrder: sessionStorage.getItem(
          'storefront-checkout-pending-order'
        ),
        idempotencyKey: localStorage.getItem('storefront-checkout-idempotency'),
      }))
    )
    .toEqual({
      cartItems: 0,
      form: null,
      pendingOrder: null,
      idempotencyKey: null,
    });
  await expect(
    page.getByRole('link', { name: 'Proceed to checkout' })
  ).toHaveAttribute('href', '/checkout?qa=manual');
  expect(await page.evaluate(() => document.cookie)).toContain(
    'checkout-qa-scenario=success'
  );
});
