import { createHash } from 'node:crypto';
import { z } from 'zod';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';

type Request = { url: string; method: string; body?: string };
type Reply = { status: number; body: string };
type Step = {
  action: 'cart-add' | 'cart-read' | 'checkout-review';
  path: string;
  evidenceDigest: string;
};

/** Call only after the host's independently authorized relay has succeeded. */
export function createPublicCommerceEvidence(settings: {
  origin: string;
  merchantId: string;
  productId: string;
  variantId?: string;
  paths: string[];
}) {
  const origin = productionOrigin(settings.origin);
  const merchantId = z.uuid().parse(settings.merchantId);
  const productId = z.uuid().parse(settings.productId);
  const variantId =
    settings.variantId === undefined
      ? undefined
      : z.uuid().parse(settings.variantId);
  if (
    !settings.paths.length ||
    settings.paths.length > 128 ||
    settings.paths.some((path) => normalizeExperiencePath(path) !== path)
  )
    throw Error('INVALID_PUBLIC_ROUTES');
  const allowed = new Set([...settings.paths, '/cart', '/checkout']);
  const line = z.object({
    item: z.object({
      productId: z.literal(productId),
      ...(variantId
        ? { variantId: z.literal(variantId) }
        : { variantId: z.undefined().optional() }),
    }),
    quantity: z.literal(1),
  });
  const snapshot = z.object({
    cartId: z.uuid(),
    merchantId: z.literal(merchantId),
    version: z.number().int().positive(),
    lines: z.array(line).length(1),
  });
  const checkoutSnapshot = z.object({
    cartId: z.uuid(),
    merchantId: z.literal(merchantId),
    cartVersion: z.number().int().positive(),
    checkoutSessionId: z.uuid(),
    lines: z
      .array(
        z.object({
          productId: z.literal(productId),
          variantId: variantId ? z.literal(variantId) : z.null().optional(),
          quantity: z.literal(1),
          available: z.literal(true),
        })
      )
      .length(1),
  });
  const steps: Step[] = [];
  let cartId: string | undefined;
  let version = 0;
  let failed = false;
  return {
    observe(request: Request, response: Reply, pageUrl: string) {
      if (failed) throw Error('PUBLIC_COMMERCE_EVIDENCE_INVALID');
      try {
        const url = new URL(request.url);
        if (
          url.origin !== origin ||
          response.status < 200 ||
          response.status >= 300
        )
          return;
        const expected = steps.length;
        let action: Step['action'] | undefined;
        if (
          expected === 0 &&
          request.method === 'POST' &&
          url.pathname === '/api/storefront/cart/commands'
        ) {
          const body = JSON.parse(request.body ?? '');
          if (body?.command?.type === 'add') {
            line.parse(body.command);
            action = 'cart-add';
          }
        } else if (
          expected === 1 &&
          request.method === 'GET' &&
          url.pathname === '/api/storefront/cart'
        )
          action = 'cart-read';
        else if (
          expected === 2 &&
          request.method === 'POST' &&
          url.pathname === '/api/storefront/cart/checkout'
        )
          action = 'checkout-review';
        if (!action) return;
        const page = new URL(pageUrl);
        if (
          page.origin !== origin ||
          page.search ||
          page.hash ||
          !allowed.has(page.pathname)
        )
          throw Error();
        const body: unknown = JSON.parse(response.body);
        const parsed = z
          .object({
            cart: snapshot.optional(),
            snapshot: checkoutSnapshot.optional(),
          })
          .parse(body);
        const observed =
          action === 'checkout-review' ? parsed.snapshot : parsed.cart;
        const observedVersion =
          action === 'checkout-review'
            ? parsed.snapshot?.cartVersion
            : parsed.cart?.version;
        if (
          !observed ||
          (cartId && observed.cartId !== cartId) ||
          observedVersion === undefined ||
          observedVersion < version
        )
          throw Error();
        if (
          action === 'checkout-review' &&
          JSON.parse(request.body ?? '').cartId !== observed.cartId
        )
          throw Error();
        cartId = observed.cartId;
        version = observedVersion;
        const evidenceDigest = createHash('sha256')
          .update(
            JSON.stringify({ action, path: page.pathname, request, response })
          )
          .digest('hex');
        steps.push({ action, path: page.pathname, evidenceDigest });
      } catch {
        failed = true;
        throw Error('PUBLIC_COMMERCE_EVIDENCE_INVALID');
      }
    },
    complete() {
      if (failed || steps.length !== 3)
        throw Error('PUBLIC_COMMERCE_EVIDENCE_INCOMPLETE');
      return [...steps];
    },
  };
}
