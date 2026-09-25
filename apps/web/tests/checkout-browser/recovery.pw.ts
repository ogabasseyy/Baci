import { expect, test } from './network';
import { order, seedCheckout } from './setup';

for (const authenticated of [false, true]) {
  test(`${authenticated ? 'authenticated session' : 'guest'} submits once and reuses the same order after returning from payment`, async ({
    page,
  }) => {
    await seedCheckout(page, { authenticated });
    let created = 0;
    let reused = 0;
    const initialized: string[] = [];
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/orders', async (route) => {
      created++;
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      expect(route.request().postDataJSON()).toMatchObject({
        expected_total: 107500,
        tax_amount: 7500,
      });
      await pending;
      await route.fulfill({ json: { order, amountDueToGateway: 107500 } });
    });
    await page.route('**/api/orders/reuse', (route) => {
      reused++;
      expect(route.request().postDataJSON()).toMatchObject({
        order_id: order.id,
        tracking_token: order.tracking_token,
      });
      return route.fulfill({ json: { order } });
    });
    await page.route('**/api/storefront/orders/**', (route) =>
      route.fulfill({ json: order })
    );
    await page.route('**/api/payments/initialize', (route) => {
      const body = route.request().postDataJSON();
      initialized.push(body.order_id);
      expect(body.currency).toBe('NGN');
      return route.fulfill({
        json: {
          success: true,
          reference: 'fixture-payment-reference',
          authorization_url: '/payment-handoff',
        },
      });
    });
    const initialValidation = page.waitForResponse('**/api/cart/validate');
    await page.goto('/checkout');
    await (await initialValidation).finished();
    await page.getByRole('radio', { name: /paystack/i }).press('Space');
    const action = page.getByRole('button', {
      name: 'Place Order',
      exact: true,
    });
    await expect(action).toBeEnabled();
    // Exercise two immediate user activations, including the interval before
    // React commits its disabled state. The in-flight guard must still hold.
    await action.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect.poll(() => created).toBe(1);
    release();
    await expect(page).toHaveURL(/\/payment-handoff$/);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem('storefront-checkout-pending-order') || '{}'
          ).orderId
      )
    ).toBe(order.id);
    const returnValidation = page.waitForResponse('**/api/cart/validate');
    await page.goBack();
    await (await returnValidation).finished();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByRole('radio', { name: /paystack/i }).press('Space');
    await page
      .getByRole('button', { name: 'Place Order', exact: true })
      .click();
    await expect(page).toHaveURL(/\/payment-handoff$/);
    expect(created).toBe(1);
    expect(reused).toBe(1);
    expect(initialized).toEqual([order.id, order.id]);
  });
}

test('previews and submits VAT locally without a calculate-commerce request', async ({
  page,
}) => {
  await seedCheckout(page);
  let commerceRequests = 0;
  await page.route('**/functions/v1/calculate-commerce', (route) => {
    commerceRequests++;
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/orders', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      expected_total: 107500,
      tax_amount: 7500,
    });
    return route.fulfill({ json: { order, amountDueToGateway: 107500 } });
  });
  await page.route('**/api/payments/initialize', (route) =>
    route.fulfill({
      json: {
        success: true,
        reference: 'fixture-payment-reference',
        authorization_url: '/payment-handoff',
      },
    })
  );
  const initialValidation = page.waitForResponse('**/api/cart/validate');
  await page.goto('/checkout');
  await (await initialValidation).finished();

  await expect(
    page.getByText('VAT (7.5%)', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect(
    page.getByText('₦7,500', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect(
    page.getByText('₦107,500', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect.poll(() => commerceRequests).toBe(0);

  await page.getByRole('radio', { name: /paystack/i }).press('Space');
  const orderResponse = page.waitForResponse('**/api/orders');
  await page.getByRole('button', { name: 'Place Order', exact: true }).click();
  await orderResponse;
  await expect.poll(() => commerceRequests).toBe(0);
});

test('resumed order shows server totals and contact details with an empty cart', async ({
  page,
}) => {
  await seedCheckout(page, { emptyCart: true });
  let lookups = 0;
  await page.route('**/api/storefront/orders/**', (route) => {
    lookups++;
    const url = new URL(route.request().url());
    expect(url.searchParams.get('merchant_slug')).toBe('ogabassey');
    expect(url.searchParams.get('token')).toBe(order.tracking_token);
    return route.fulfill({ json: order });
  });
  await page.goto(
    `/checkout?orderId=${order.id}&trackingToken=${order.tracking_token}`
  );
  await expect(
    page.getByRole('heading', { name: 'Order Summary' })
  ).toBeVisible();
  await expect(
    page.getByText('₦107,500', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect(
    page
      .getByText('Checkout test phone', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Contact Information' })
  ).toHaveAccessibleDescription('Ada Okon · +2348031234567');
  await expect(
    page.getByRole('button', { name: 'Place Order', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Contact Information' }).click();
  await page.getByRole('textbox', { name: 'First Name' }).fill('Grace');
  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  expect(lookups).toBe(1);
});
