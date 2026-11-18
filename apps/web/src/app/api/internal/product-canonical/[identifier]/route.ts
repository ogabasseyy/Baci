import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
  getCachedProductCanonicalRedirectTarget,
} from '@/lib/cached-data';
import { getCachedStorefrontProductSlugResolution } from '@/lib/cached-storefront-product-slug-resolution';
import {
  getValidatedInternalAuthMethod,
  INTERNAL_AUTH_HEADER,
} from '@/lib/internal-auth-header';
import { getProductSlugSetCacheTag } from '@/lib/product-cache-tags';
import { UNKNOWN_STOREFRONT_FAIL_OPEN_REASON } from '@/lib/storefront-internal-preflight';
import {
  buildStorefrontPdpCanonicalPath,
  normalizeStorefrontPdpPathForCompare,
  type StorefrontPdpCanonicalSource,
} from '@/lib/storefront-pdp-canonical-path';
import { isDomainIdentifier } from '@/lib/validation';
import {
  internalProductCanonicalRedirectQuerySchema,
  internalSlugSetParamsSchema,
} from '@/schemas/internal-slug-set-route';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const FAIL_OPEN = { hasError: true, matchedProduct: false, redirectPath: null };
const NO_REDIRECT = {
  hasError: false,
  matchedProduct: false,
  redirectPath: null,
};
// Same cacheable-verdict mechanics as the slug-set/blog-post-status preflights:
// the proxy authenticates via `x-baci-internal-auth` (an `Authorization` header
// makes a response ineligible for Vercel's CDN cache), `Vary` keys the edge
// entry to the secret value, and the `Vercel-Cache-Tag` is the SAME
// `product-slug-set-${merchantId}` tag that `revalidateProducts` invalidates on
// every product mutation. Only the definitive live no-redirect verdict
// (`matchedProduct: true`, no redirectPath) is cached — it is self-healing (the
// page itself still canonicalizes or 404s a since-changed product). Redirect
// verdicts, absent verdicts, and every fail-open branch stay no-store so a
// changed canonical target or a since-published product is never sticky for
// the TTL window.
//
// ACCEPTED BOUNDED STALENESS: `revalidateTag(tag, profile)` marks the 'use
// cache' sources stale and serves the stale entry ONCE while refreshing in the
// background (see lib/cache-revalidation.ts), so the first request after a
// canonical-path change can recompute this verdict from stale data and re-cache
// it for up to s-maxage (300s, +1 SWR serve per region). Users are unaffected
// (the PDP route still emits its own permanentRedirect); only crawler-visible
// proxy 308s lag for that window on the rare category/canonical mutation.
// Blocking expiry is not available here: `updateTag` is Server-Action-only and
// revalidateProducts/revalidateCategories run in route handlers.
const PREFLIGHT_CACHE = {
  'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
  Vary: INTERNAL_AUTH_HEADER,
} as const;

interface CanonicalVerdictBody {
  hasError: boolean;
  matchedProduct: boolean;
  redirectPath: string | null;
  /** Present when the fail-open is expected (no published storefront), not an incident. */
  failOpenReason?: 'unknown-storefront';
}

function toVerdictResponse(
  body: CanonicalVerdictBody,
  cacheTagMerchantId: string,
  allowEdgeCache: boolean
): NextResponse {
  const cacheable =
    allowEdgeCache &&
    body.hasError === false &&
    body.matchedProduct === true &&
    body.redirectPath === null;

  return NextResponse.json(body, {
    status: 200,
    headers: cacheable
      ? {
          ...PREFLIGHT_CACHE,
          // Two purge paths (comma = tag separator): product mutations purge
          // `product-slug-set-${merchantId}` via revalidateProducts, and
          // CATEGORY slug changes — which move a product's canonical path
          // without any slug-set mutation — purge the merchant-scoped
          // `product-canonical-redirect-${merchantId}` tag (kept alongside the
          // legacy `product-canonical-redirect` tag) that the underlying
          // 'use cache' lookup carries and revalidateCategories invalidates.
          'Vercel-Cache-Tag': `${getProductSlugSetCacheTag(
            cacheTagMerchantId
          )},product-canonical-redirect,product-canonical-redirect-${cacheTagMerchantId}`,
        }
      : NO_STORE,
  });
}

interface ProductUrlSource extends StorefrontPdpCanonicalSource {
  status?: string | null;
}

async function getPublishedMerchant(identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const merchant = isDomainIdentifier(normalizedIdentifier)
    ? await getCachedMerchantByDomain(normalizedIdentifier)
    : await getCachedMerchant(normalizedIdentifier);

  return merchant?.is_published ? merchant : null;
}

function getRedirectResponseForTarget(
  requestedCategory: string,
  requestedSlug: string,
  target: ProductUrlSource
) {
  const targetPath = buildStorefrontPdpCanonicalPath(target);
  const requestedPath = `/${requestedCategory}/${requestedSlug}`;

  if (
    normalizeStorefrontPdpPathForCompare(targetPath) ===
    normalizeStorefrontPdpPathForCompare(requestedPath)
  ) {
    return { hasError: false, matchedProduct: true, redirectPath: null };
  }

  return { hasError: false, matchedProduct: true, redirectPath: targetPath };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ identifier: string }> }
): Promise<NextResponse> {
  const expectedSecret = getInternalApiSecret();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: NO_STORE }
    );
  }

  // Custom-header auth (preferred — keeps the verdict CDN-cacheable) with the
  // legacy `Authorization: Bearer` still accepted for mixed-deploy callers.
  const authMethod = getValidatedInternalAuthMethod(request, expectedSecret);
  if (!authMethod) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }
  // Only custom-header requests may receive cacheable headers: RFC 9111 §3.5
  // lets a shared cache store an Authorization-request response when s-maxage
  // is present, and such an entry would be keyed with the custom header ABSENT
  // — the same Vary key an unauthenticated request would hit.
  const allowEdgeCache = authMethod === 'custom-header';

  const params = internalSlugSetParamsSchema.safeParse(await context.params);
  const query = internalProductCanonicalRedirectQuerySchema.safeParse({
    category: request.nextUrl.searchParams.get('category'),
    slug: request.nextUrl.searchParams.get('slug'),
  });
  if (!params.success || !query.success) {
    return NextResponse.json(FAIL_OPEN, { status: 200, headers: NO_STORE });
  }

  try {
    const merchant = await getPublishedMerchant(params.data.identifier);
    if (!merchant) {
      // Definitive absence: the cached merchant lookups THROW on transient
      // errors (caught below as a plain fail-open), so a null here means no
      // published storefront exists for this identifier — expected junk
      // subdomain/bot traffic the proxy should log without capturing an
      // exception.
      return NextResponse.json(
        { ...FAIL_OPEN, failOpenReason: UNKNOWN_STOREFRONT_FAIL_OPEN_REASON },
        { status: 200, headers: NO_STORE }
      );
    }

    const product = (await getCachedProductCanonicalRedirectTarget(
      merchant.id,
      query.data.slug
    )) as ProductUrlSource | null;

    if (product?.status === 'active') {
      return toVerdictResponse(
        getRedirectResponseForTarget(
          query.data.category,
          query.data.slug,
          product
        ),
        merchant.id,
        allowEdgeCache
      );
    }

    const slugResolution = await getCachedStorefrontProductSlugResolution(
      merchant.id,
      query.data.slug
    );

    if (slugResolution.hasError) {
      return NextResponse.json(FAIL_OPEN, { status: 200, headers: NO_STORE });
    }

    if (slugResolution.redirectTarget) {
      return toVerdictResponse(
        getRedirectResponseForTarget(
          query.data.category,
          query.data.slug,
          slugResolution.redirectTarget
        ),
        merchant.id,
        allowEdgeCache
      );
    }

    if (slugResolution.present) {
      // Category-BLIND fallback: `present` only proves the slug belongs to
      // the merchant — the category-aware primary lookup above missed, so we
      // cannot prove the REQUESTED /{category}/{slug} path is canonical.
      // Caching this no-redirect verdict would suppress the proxy 308 for
      // wrong-category PDP URLs for the whole TTL window; keep it no-store.
      return toVerdictResponse(
        { hasError: false, matchedProduct: true, redirectPath: null },
        merchant.id,
        false
      );
    }

    return NextResponse.json(NO_REDIRECT, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json(FAIL_OPEN, { status: 200, headers: NO_STORE });
  }
}
