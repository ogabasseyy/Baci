import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { getStorefrontCartStorageKey } from '@/hooks/cart/cart-storage';

type Product = { id: string; path: string; variantId?: string };
type Checkout = { merchantSlug: string; variantLabel?: string };
const actionTimeout = 15000;

/** Exercise the native guest cart and inspect the checkout without submitting it. */
export async function observeNativeCheckout(
  page: Page,
  product: Product,
  checkout: Checkout,
  checkoutUrl: string
) {
  const storageKey = getStorefrontCartStorageKey(checkout.merchantSlug);
  const line = {
    id: product.id,
    variantId: product.variantId ?? '',
    quantity: 1,
  };
  // The native provider persists its initial cart after hydration. An SSR
  // button can be visible while React still has no active click handler.
  await page.waitForFunction(
    (key) => localStorage.getItem(key) === '[]',
    storageKey,
    {
      timeout: actionTimeout,
    }
  );
  const add = page
    .locator(
      '[data-baci-pdp-cart-ready="true"], [data-ogabassey-pdp-commerce-primary-action]'
    )
    .and(page.getByRole('button', { name: /^add to cart$/i }))
    .filter({ visible: true });
  await add.waitFor({ state: 'visible', timeout: actionTimeout });

  if (checkout.variantLabel) {
    for (const label of checkout.variantLabel.split(' / ')) {
      const options = page
        .locator('[data-ogabassey-pdp-commerce-variant-option]')
        .and(page.getByText(label, { exact: true }))
        .or(page.getByRole('button', { name: label, exact: true }))
        .filter({ visible: true });
      await options.click({ timeout: actionTimeout });
    }
  }
  await add.click({ timeout: actionTimeout });
  await page.waitForFunction(
    ({ key, expected }) => {
      const items = JSON.parse(localStorage.getItem(key) ?? '[]');
      return (
        Array.isArray(items) &&
        items.length === 1 &&
        items[0].id === expected.id &&
        (items[0].variantId ?? '') === expected.variantId &&
        items[0].quantity === expected.quantity
      );
    },
    { key: storageKey, expected: line },
    { timeout: actionTimeout }
  );
  const response = await page.goto(checkoutUrl, {
    waitUntil: 'domcontentloaded',
    timeout: actionTimeout,
  });
  if (response?.status() !== 200 || page.url() !== checkoutUrl)
    throw Error('PUBLIC_NATIVE_CHECKOUT_MISMATCH');
  const selector =
    `[data-baci-checkout-product="${line.id}"]` +
    `[data-baci-checkout-variant="${line.variantId}"]` +
    `[data-baci-checkout-quantity="${line.quantity}"]`;
  const checkoutLine = page.locator(selector);
  await checkoutLine.waitFor({ state: 'visible', timeout: actionTimeout });
  await page
    .locator('input[name="firstName"]')
    .waitFor({ state: 'visible', timeout: actionTimeout });
  if (
    page.url() !== checkoutUrl ||
    (await page.locator('iframe[data-baci-experience-build]').count()) !== 0
  )
    throw Error('PUBLIC_NATIVE_CHECKOUT_MISMATCH');
  const checkoutPath = new URL(checkoutUrl).pathname;
  const evidence = (
    action: 'cart-add' | 'cart-read' | 'checkout-review',
    path: string
  ) => ({
    action,
    path,
    evidenceDigest: createHash('sha256')
      .update(JSON.stringify({ action, path, line }))
      .digest('hex'),
  });
  return [
    evidence('cart-add', product.path),
    evidence('cart-read', checkoutPath),
    evidence('checkout-review', checkoutPath),
  ];
}
