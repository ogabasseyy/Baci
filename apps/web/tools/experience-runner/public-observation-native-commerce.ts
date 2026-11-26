import type { Page } from 'playwright-core';
import type { createPublicCommerceEvidence } from './public-commerce-evidence';

/** Verify the existing Baci cart and checkout-preparation routes from a native PDP. */
export async function observeNativePublicCommerce(
  page: Page,
  product: { id: string; variantId?: string },
  evidence: ReturnType<typeof createPublicCommerceEvidence>
) {
  await page.evaluate(async (item) => {
    const signal = AbortSignal.timeout(45000);
    async function request(path: string, body?: object) {
      const response = await fetch(`/api/storefront/cart${path}`, {
        signal,
        ...(body && {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });
      if (!response.ok) throw Error('PUBLIC_CHECKOUT_UNAVAILABLE');
      return response.json();
    }

    await request('/bootstrap', {});
    const created = await request('', { operationId: crypto.randomUUID() });
    await request('/commands', {
      operationId: crypto.randomUUID(),
      expectedVersion: created.cart.version,
      command: {
        type: 'add',
        item: {
          productId: item.id,
          ...(item.variantId ? { variantId: item.variantId } : {}),
        },
        quantity: 1,
      },
    });
    const current = await request('');
    await request('/checkout', {
      operationId: crypto.randomUUID(),
      expectedVersion: current.cart.version,
      cartId: current.cart.cartId,
    });
  }, product);
  return evidence.complete();
}
