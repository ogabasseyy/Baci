import { expect, test } from './network';
import { seedCheckout } from './setup';

test('manual shipping fixture renders and selects the real local door quote', async ({
  page,
}) => {
  await seedCheckout(page, { startAtContact: true });
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
});
