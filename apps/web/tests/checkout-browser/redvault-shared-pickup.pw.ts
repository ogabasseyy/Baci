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
