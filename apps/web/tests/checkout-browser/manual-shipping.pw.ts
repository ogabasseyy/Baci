import { expect, test } from './network';
import { seedCheckout } from './setup';

test('manual shipping fixture renders and selects the real local door quote', async ({
  page,
}) => {
  const reviewerEmail = 'checkout-reviewer@example.test';
  await seedCheckout(page, {
    startAtContact: true,
    customerEmail: reviewerEmail,
  });
  const cartValidation = page.waitForResponse('**/api/cart/validate');
  await page.goto('/checkout?qa=manual-checkout-flow');
  await (await cartValidation).finished();

  await page.getByRole('button', { name: 'Continue to Delivery' }).click();
  await expect(
    page.getByRole('button', { name: /Delivery Method/ })
  ).toHaveAttribute('aria-expanded', 'true');

  const quoteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/shipping/quotes') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().receiver.address.includes('12 Broad')
  );
  const address = page.getByRole('textbox', { name: /Delivery Address/ });
  await address.fill('12 Broad Street, Lagos Island, Lagos');
  await expect(page.getByText('Detected: Lagos Island, Lagos')).toBeVisible();

  const response = await quoteResponse;
  expect(response.status()).toBe(200);
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
      response.request().postDataJSON().receiver.address.includes('12 Broad')
  );
  await address.fill('12 Broad Street, Lagos Island, Lagos');
  expect((await refreshedQuoteResponse).status()).toBe(200);
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  const paystack = page.getByRole('radio', { name: /paystack/i });
  await expect(paystack).toBeVisible();
  await paystack.press('Space');
  await expect(paystack).toBeChecked();
  const placeOrder = page.getByRole('button', {
    name: 'Place Order',
    exact: true,
  });
  await expect(placeOrder).toBeEnabled();
  await page.context().addCookies([
    {
      name: 'checkout-qa-scenario',
      value: 'provider-error',
      url: page.url(),
    },
  ]);
  let orderCreationRequests = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/orders' &&
      request.method() === 'POST'
    )
      orderCreationRequests += 1;
  });
  const orderResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/orders') &&
      response.request().method() === 'POST'
  );
  const paymentResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/payments/initialize') &&
      response.request().method() === 'POST'
  );
  await placeOrder.click();
  const submittedOrderResponse = await orderResponse;
  expect(submittedOrderResponse.status()).toBe(200);
  expect((await paymentResponse).status()).toBe(503);
  await expect(
    page.getByText('Checkout Failed', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Fixture provider error. No payment was sent.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(placeOrder).toBeEnabled();

  const lookupResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/storefront/orders/') &&
      response.request().method() === 'GET'
  );
  const reuseResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/orders/reuse') &&
      response.request().method() === 'POST'
  );
  const retryPaymentResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/payments/initialize') &&
      response.request().method() === 'POST'
  );
  await placeOrder.click();

  const lookedUpOrder = await lookupResponse;
  expect(lookedUpOrder.status()).toBe(200);
  expect(await lookedUpOrder.json()).toMatchObject({
    customer_email: reviewerEmail,
  });
  const reusedOrder = await reuseResponse;
  expect(reusedOrder.status()).toBe(200);
  expect(reusedOrder.request().postDataJSON()).toMatchObject({
    customer_email: reviewerEmail,
  });
  expect(await reusedOrder.json()).toMatchObject({
    order: { customer_email: reviewerEmail },
  });
  expect((await retryPaymentResponse).status()).toBe(503);
  expect(orderCreationRequests).toBe(1);
  await expect(placeOrder).toBeEnabled();
});
