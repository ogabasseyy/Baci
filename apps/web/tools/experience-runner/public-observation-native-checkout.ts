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
  const expectedLine = {
    id: product.id,
    variantId: product.variantId ?? '',
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
      // The native PDP can omit an already-resolved single-option axis.
      // The cart and checkout must still carry the exact bound variant ID.
      if (await options.count())
        await options.click({ timeout: actionTimeout });
    }
  }
  await add.click({ timeout: actionTimeout });
  // The native PDP selects an allowed starting quantity, which can exceed one.
  // Carry the observed quantity forward and check the same line at checkout.
  const addedQuantity = await page.waitForFunction(
    ({ key, expected }) => {
      const items = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (!Array.isArray(items) || items.length !== 1) return false;
      const [item] = items;
      const quantity: unknown = item?.quantity;
      return (
        item?.id === expected.id &&
        (item.variantId ?? '') === expected.variantId &&
        typeof quantity === 'number' &&
        Number.isSafeInteger(quantity) &&
        quantity > 0 &&
        quantity
      );
    },
    { key: storageKey, expected: expectedLine },
    { timeout: actionTimeout }
  );
  const quantity = await addedQuantity.jsonValue();
  await addedQuantity.dispose();
  if (!quantity) throw Error('PUBLIC_NATIVE_CART_MISMATCH');
  const line = { ...expectedLine, quantity };
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
