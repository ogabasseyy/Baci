import { expect, test } from './network';
import { order, seedCheckout } from './setup';

test('switches card rails and retries provider initialization against the same order', async ({
  page,
}) => {
  await seedCheckout(page);
  let created = 0;
  let reused = 0;
  let initializationAttempts = 0;
  const initializedGateways: string[] = [];
  await page.route('**/api/orders', (route) => {
    created++;
    return route.fulfill({ json: { order, amountDueToGateway: 107500 } });
  });
  await page.route('**/api/orders/reuse', (route) => {
    reused++;
    expect(route.request().postDataJSON()).toMatchObject({
      order_id: order.id,
    });
    return route.fulfill({ json: { order } });
  });
  await page.route('**/api/storefront/orders/**', (route) =>
    route.fulfill({ json: order })
  );
  await page.route('**/api/payments/initialize', (route) => {
    initializationAttempts++;
    const body = route.request().postDataJSON();
    initializedGateways.push(body.gateway);
    expect(body.gateway).toBe('korapay');
    if (initializationAttempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: 'Fixture provider error' },
      });
    return route.fulfill({
      json: {
        success: true,
        reference: 'fixture-korapay-reference',
        authorization_url: '/payment-handoff',
      },
    });
  });

  const initialValidation = page.waitForResponse('**/api/cart/validate');
  await page.goto('/checkout?qa=payment-retry');
  await (await initialValidation).finished();

  const paystack = page.getByRole('radio', { name: /paystack/i });
  const korapay = page.getByRole('radio', { name: /korapay/i });
  await expect(paystack).toBeVisible();
  await expect(korapay).toBeVisible();
  await korapay.press('Space');
  await expect(korapay).toBeChecked();
  await paystack.press('Space');
  await expect(paystack).toBeChecked();
  await korapay.press('Space');

  const action = page.getByRole('button', { name: 'Place Order', exact: true });
  await action.click();
  await expect.poll(() => initializationAttempts).toBe(1);
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page).toHaveURL(/\/payment-handoff$/);
  expect(created).toBe(1);
  expect(reused).toBe(1);
  expect(initializationAttempts).toBe(2);
  expect(initializedGateways).toEqual(['korapay', 'korapay']);
});
