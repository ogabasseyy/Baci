import { expect, test } from './network';
import { seedRedvaultSharedPickup } from './redvault-shared-pickup-fixture';

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`shared UBA free pickup on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('continues the reviewed order after the empty-cart quote is rejected', async ({
      page,
      baseURL,
    }) => {
      if (!baseURL)
        throw new Error('Checkout fixture requires a local base URL');
      const calls = await seedRedvaultSharedPickup(page, baseURL);
      await page.goto('/checkout-shared?qa=redvault-shared-pickup');
      await page.getByRole('radio', { name: /Pay with UBA/i }).press('Space');
      await page
        .getByRole('button', { name: 'Place Order', exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page
          .getByRole('button', { name: 'Review and continue to UBA' })
          .filter({ visible: true })
          .first()
      ).toBeVisible();
      await expect(
        page.getByText('102.50', { exact: false }).first()
      ).toBeVisible();

      await page.reload();
      await expect.poll(() => calls.emptyQuotes).toBeGreaterThan(0);
      const confirm = page
        .getByRole('button', { name: 'Review and continue to UBA' })
        .filter({ visible: true })
        .first();
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await page.waitForURL(`${baseURL}/payment-handoff`);
      expect(calls.orders).toBe(1);
      expect(calls.cancellations).toBe(0);
      expect(calls.initializations).toBe(1);
    });

    test('cancels the reviewed draft when contact details change', async ({
      page,
      baseURL,
    }) => {
      if (!baseURL)
        throw new Error('Checkout fixture requires a local base URL');
      const calls = await seedRedvaultSharedPickup(page, baseURL);
      await page.goto('/checkout-shared?qa=redvault-shared-pickup');
      await page.getByRole('radio', { name: /Pay with UBA/i }).press('Space');
      await page
        .getByRole('button', { name: 'Place Order', exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page
          .getByRole('button', { name: 'Review and continue to UBA' })
          .filter({ visible: true })
          .first()
      ).toBeVisible();
      await page.reload();
      await expect.poll(() => calls.emptyQuotes).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Contact Information' }).click();
      await page.getByLabel('First Name *').fill('Adanna');
      await page.getByRole('button', { name: 'Continue to Delivery' }).click();
      await page.getByRole('button', { name: /Continue to Payment/i }).click();
      await page
        .getByRole('button', { name: 'Review and continue to UBA' })
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page.getByText('Checkout review cancelled').first()
      ).toBeVisible();
      expect(calls.orders).toBe(1);
      expect(calls.cancellations).toBe(1);
      expect(calls.initializations).toBe(0);
    });
  });
}

test.describe('shared UBA checkout after a lost order response', () => {
  test.use({
    allowedConsoleErrors: [
      'Failed to load resource: net::ERR_FAILED',
      'Failed to load resource: net::ERR_FAILED',
      'Checkout error: TypeError: Failed to fetch',
    ],
  });

  test('restores the original review after both create responses are lost', async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Checkout fixture requires a local base URL');
    const calls = await seedRedvaultSharedPickup(page, baseURL, {
      lostOrderResponses: 2,
    });
    await page.goto('/checkout-shared?qa=redvault-shared-pickup&lost=1');
    await page.getByRole('radio', { name: /Pay with UBA/i }).press('Space');
    await page
      .getByRole('button', { name: 'Place Order', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.getByText('Checkout Failed', { exact: true }).first()
    ).toBeVisible();
    await page.reload();
    const confirm = page
      .getByRole('button', { name: 'Review and continue to UBA' })
      .filter({ visible: true })
      .first();
    await expect(confirm).toBeEnabled({ timeout: 8000 });
    expect(calls.orders).toBe(3);
    expect(calls.createdOrders).toBe(1);
    expect(calls.prepareBodies[0]).toMatchObject({ recoveryForRedvault: true });
    expect(calls.orderRequests[2]).toEqual(calls.orderRequests[0]);
    expect(calls.recoveryHeaders[0]).toBeUndefined();
    expect(calls.recoveryHeaders[1]).toBe('1');
    expect(calls.recoveryHeaders[2]).toBe('1');
    expect(calls.initializations).toBe(0);
    await confirm.click();
    await page.waitForURL(`${baseURL}/payment-handoff`);
    expect(calls.initializations).toBe(1);
  });

  test('hides the review if another tab retires the cart authority', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Checkout fixture requires a local base URL');
    const calls = await seedRedvaultSharedPickup(page, baseURL);
    await page.goto('/checkout-shared?qa=redvault-shared-pickup');
    await page.getByRole('radio', { name: /Pay with UBA/i }).press('Space');
    await page
      .getByRole('button', { name: 'Place Order', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const confirm = page
      .getByRole('button', { name: 'Review and continue to UBA' })
      .filter({ visible: true })
      .first();
    await expect(confirm).toBeVisible();
    const otherTab = await context.newPage();
    try {
      await otherTab.goto(`${baseURL}/payment-handoff`);
      await otherTab.evaluate(() =>
        localStorage.setItem(
          'baci-cart-authority-epoch:ogabassey',
          'retired-by-other-tab'
        )
      );
      await expect(confirm).toBeHidden();
      expect(calls.initializations).toBe(0);
    } finally {
      await otherTab.close();
    }
  });
});
