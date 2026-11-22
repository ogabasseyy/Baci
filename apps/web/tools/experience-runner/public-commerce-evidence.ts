import { createHash } from 'node:crypto';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';

import {
  publicCommerceEvidenceIdentity,
  publicCommerceEvidenceSchemas,
} from '@/schemas/experience-public-commerce-evidence';

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
  const { merchantId, productId, variantId } =
    publicCommerceEvidenceIdentity.parse(settings);
  if (
    !settings.paths.length ||
    settings.paths.length > 128 ||
    settings.paths.some((path) => normalizeExperiencePath(path) !== path)
  )
    throw Error('INVALID_PUBLIC_ROUTES');
  const allowed = new Set([...settings.paths, '/cart', '/checkout']);
  const { line, responseSchema } = publicCommerceEvidenceSchemas({
    merchantId,
    productId,
    variantId,
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
        const parsed = responseSchema.parse(body);
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
