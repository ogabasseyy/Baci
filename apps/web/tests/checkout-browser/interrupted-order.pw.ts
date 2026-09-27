import { expect, test } from './network';
import { order, seedCheckout } from './setup';

test.use({
  allowedConsoleErrors: async ({ browserName }, use) => {
    // WebKit can deliver the fetch rejection before the old document unloads.
    // Permit that single known message; all other console/page errors fail.
    await use(
      browserName === 'webkit' ? ['Checkout error: TypeError: Load failed'] : []
    );
  },
});

for (const authenticated of [false, true]) {
  test(`${authenticated ? 'authenticated session' : 'guest'} preserves the order request identity when its response is interrupted`, async ({
    page,
  }) => {
    await seedCheckout(page, { authenticated });
    const submissions: { key: string | undefined; body: unknown }[] = [];
    let releaseResponse: () => void = () => undefined;
    const interruptedResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let initializations = 0;

    await page.route('**/api/orders', async (route) => {
      submissions.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      // Model an order committed by the server while its response never
      // reaches the old document. On retry the API returns that same order.
      if (submissions.length === 1) await interruptedResponse;
      await route.fulfill({ json: { order, amountDueToGateway: order.total } });
    });
    await page.route('**/api/payments/initialize', (route) => {
      initializations++;
      expect(route.request().postDataJSON()).toMatchObject({
        order_id: order.id,
        currency: order.currency,
      });
      return route.fulfill({
        json: {
          success: true,
          reference: 'fixture-payment-reference',
          authorization_url: '/payment-handoff',
        },
      });
    });

    try {
      const validation = page.waitForResponse('**/api/cart/validate');
      await page.goto('/checkout');
      await (await validation).finished();
      await page.getByRole('radio', { name: /paystack/i }).press('Space');
      await page
        .getByRole('button', { name: 'Place Order', exact: true })
        .click();
      await expect.poll(() => submissions.length).toBe(1);
      expect(submissions[0].key).toBeTruthy();
      expect(initializations).toBe(0);

      const revalidation = page.waitForResponse('**/api/cart/validate');
      await page.reload();
      await (await revalidation).finished();
      releaseResponse();

      // A reload must restore a usable submit action without rotating the
      // durable key or depending on a pending-order response we never saw.
      await page.getByRole('radio', { name: /paystack/i }).press('Space');
      const action = page.getByRole('button', {
        name: 'Place Order',
        exact: true,
      });
      await expect(action).toBeEnabled();
      await action.click();
      await expect(page).toHaveURL(/\/payment-handoff$/);
      expect(submissions).toHaveLength(2);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(initializations).toBe(1);
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              sessionStorage.getItem('storefront-checkout-pending-order') ||
                '{}'
            ).orderId
        )
      ).toBe(order.id);
    } finally {
      releaseResponse();
    }
  });
}
