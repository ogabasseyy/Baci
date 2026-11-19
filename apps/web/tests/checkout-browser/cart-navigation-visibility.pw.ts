import { cartItem } from './fixtures';
import { expect, test } from './network';

test('desktop cart checkout action survives a product CSS route transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript((item) => {
    localStorage.setItem('baci-cart-ogabassey-guest', JSON.stringify([item]));
  }, cartItem);

  await page.goto('/cart-navigation-start');
  await page.getByRole('link', { name: 'View test phone' }).click();
  await expect(page).toHaveURL(/\/products\/test-phone$/);
  const lateProductStylesheet = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return {
            href: sheet.href,
            cssText: Array.from(sheet.cssRules)
              .map((rule) => rule.cssText)
              .join('\n'),
          };
        } catch {
          return null;
        }
      })
      .find(
        (sheet) =>
          sheet?.cssText.includes('.hidden') &&
          sheet.cssText.includes('.md\\:hidden') &&
          !sheet.cssText.includes('.md\\:flex')
      )
  );
  expect(lateProductStylesheet).toBeDefined();
  await page.getByRole('link', { name: 'View cart' }).click();
  const routeStylesheetPersists = await page.evaluate(
    (href) =>
      Array.from(document.styleSheets).some((sheet) => sheet.href === href),
    lateProductStylesheet?.href ?? ''
  );
  expect(routeStylesheetPersists).toBe(true);

  const checkoutAction = page.getByRole('button', {
    name: /Proceed to Checkout/,
  });
  await expect(checkoutAction).toBeVisible();
  await expect(checkoutAction).toContainText('₦100,000');
  await checkoutAction.click({ trial: true });
  await expect(
    page.getByRole('button', { name: /^Checkout • ₦100,000$/ })
  ).toBeHidden();
  await page.reload();
  await expect(checkoutAction).toBeVisible();
  await checkoutAction.click();
  await expect(page).toHaveURL(/\/checkout$/);
});

test('cart summary checkout action remains hidden on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((item) => {
    localStorage.setItem('baci-cart-ogabassey-guest', JSON.stringify([item]));
  }, cartItem);

  await page.goto('/cart-navigation-start');
  await page.getByRole('link', { name: 'View test phone' }).click();
  await page.getByRole('link', { name: 'View cart' }).click();

  await expect(
    page.getByRole('button', { name: /Proceed to Checkout/ })
  ).toBeHidden();
  const mobileCheckout = page.getByRole('button', {
    name: /^Checkout • ₦100,000$/,
  });
  await expect(mobileCheckout).toBeVisible();
  await mobileCheckout.click();
  await expect(page).toHaveURL(/\/checkout$/);
});

test('cart keeps the compact checkout action visible at tablet widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 900 });
  await page.addInitScript((item) => {
    localStorage.setItem('baci-cart-ogabassey-guest', JSON.stringify([item]));
  }, cartItem);
  await page.goto('/cart-navigation-start');
  await page.getByRole('link', { name: 'View test phone' }).click();
  await page.getByRole('link', { name: 'View cart' }).click();
  await expect(
    page.getByRole('button', { name: /Proceed to Checkout/ })
  ).toBeHidden();
  const checkout = page.getByRole('button', { name: /^Checkout • ₦100,000$/ });
  await expect(checkout).toBeVisible();
  await expect(checkout).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(checkout).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.evaluate(() => {
    document.documentElement.style.setProperty(
      '--store-checkout-button-bg',
      '#123456'
    );
  });
  await expect(checkout).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await checkout.click();
  await expect(page).toHaveURL(/\/checkout$/);
});

for (const width of [1023, 1024]) {
  test(`cart checkout handoff works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((item) => {
      localStorage.setItem('baci-cart-ogabassey-guest', JSON.stringify([item]));
    }, cartItem);
    await page.goto('/cart-navigation-start');
    await page.getByRole('link', { name: 'View test phone' }).click();
    await page.getByRole('link', { name: 'View cart' }).click();
    const compact = page.getByRole('button', { name: /^Checkout • ₦100,000$/ });
    const desktop = page.getByRole('button', { name: /Proceed to Checkout/ });
    if (width === 1023) {
      await expect(compact).toBeVisible();
      await expect(desktop).toBeHidden();
      await compact.click();
    } else {
      await expect(compact).toBeHidden();
      await expect(desktop).toBeVisible();
      await desktop.click();
    }
    await expect(page).toHaveURL(/\/checkout$/);
  });
}
