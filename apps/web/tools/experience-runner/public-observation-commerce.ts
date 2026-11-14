import type { Page, Response } from 'playwright-core';
import type { createPublicCommerceEvidence } from './public-commerce-evidence';

/** Run only with network-disabled routing and a host-authorized commerce relay. */
export async function observePublicCommerce(
  page: Page,
  evidence: ReturnType<typeof createPublicCommerceEvidence>,
  options: { timeoutMs?: number } = {}
) {
  const timeout = options.timeoutMs ?? 45000;
  const origin = new URL(page.url()).origin;
  const response = (path: string, method: string) => (item: Response) => {
    const url = new URL(item.url());
    return (
      url.origin === origin &&
      url.pathname === path &&
      item.request().method() === method &&
      item.ok()
    );
  };
  const frame = page.frameLocator('iframe[data-baci-experience-build]');
  await frame.locator('html[data-baci-hydration="ready"]').waitFor({ timeout });
  await Promise.all([
    page.waitForResponse(response('/api/storefront/cart/commands', 'POST'), {
      timeout,
    }),
    page.waitForResponse(response('/api/storefront/cart', 'GET'), { timeout }),
    frame
      .getByRole('button', { name: /add to (bag|cart)/i })
      .or(
        frame
          .getByRole('button')
          .and(frame.locator('[data-baci-commerce="add"]'))
      )
      .first()
      .click({ timeout }),
  ]);
  await Promise.all([
    page.waitForResponse(response('/api/storefront/cart/checkout', 'POST'), {
      timeout,
    }),
    frame
      .getByRole('button', { name: /(?:review\s+)?checkout/i })
      .or(
        frame
          .getByRole('button')
          .and(frame.locator('[data-baci-commerce="checkout"]'))
      )
      .first()
      .click({ timeout }),
  ]);
  const checkout = page.getByRole('dialog', { name: 'Continue to checkout' });
  await checkout.waitFor({ timeout });
  if (
    !(await checkout
      .getByRole('button', { name: 'Continue to checkout' })
      .isEnabled())
  )
    throw Error('PUBLIC_CHECKOUT_UNAVAILABLE');
  return evidence.complete();
}
