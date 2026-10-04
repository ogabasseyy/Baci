import { cartItem, contact } from './fixtures';
import { expect, test } from './network';

for (const width of [390, 1023, 1024, 1440]) {
  for (const entry of ['direct', 'navigation']) {
    test(`order action is visible at ${width}px after ${entry}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        ({ item, details, direct }) => {
          if (direct)
            localStorage.setItem(
              'baci-cart-ogabassey-guest',
              JSON.stringify([item])
            );
          sessionStorage.setItem(
            'checkout-form',
            JSON.stringify({
              ...details,
              currentStep: 'payment',
              completedSteps: { contact: true, delivery: true },
              newAddressState: 'Lagos',
              newAddressCity: 'Ikeja',
              deliveryMethod: 'pickup',
            })
          );
        },
        { item: cartItem, details: contact, direct: entry === 'direct' }
      );
      if (entry === 'navigation') {
        await page.goto('/catalog');
        await page.getByRole('button', { name: 'Add test phone' }).click();
        await page.getByRole('link', { name: /View cart \(1\)/ }).click();
        await page.getByRole('link', { name: 'Proceed to checkout' }).click();
      } else await page.goto('/checkout');
      // Reproduce the production cascade condition: a base utility from a
      // later route chunk follows the generated responsive utilities.
      await page.addStyleTag({
        content: '@layer utilities { .hidden { display: none; } }',
      });
      const action = page.getByRole('button', {
        name: 'Place Order',
        exact: true,
      });
      await expect(action).toBeVisible();
      await page.getByRole('radio', { name: /paystack/i }).press('Space');
      await expect(
        page.getByRole('radio', { name: /paystack/i })
      ).toBeChecked();
      await expect(action).toBeEnabled();
      await action.click({ trial: true });
      if (width === 1440 && entry === 'direct')
        await page.screenshot({
          path: testInfo.outputPath('checkout-desktop.png'),
          fullPage: true,
        });
      if (width >= 1024)
        await expect(
          page.getByRole('heading', { name: 'Order Summary' })
        ).toBeVisible();
    });
  }
}
