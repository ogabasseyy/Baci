import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import {
  getValidatedInternalAuthMethod,
  INTERNAL_AUTH_HEADER,
} from '@/lib/internal-auth-header';
import { getProductSlugSetCacheTag } from '@/lib/product-cache-tags';
import { resolveComparePageStatus } from '@/lib/storefront-compare/resolve-compare-page-status';
import {
  type InternalComparePageStatusBody,
  internalComparePageStatusQuerySchema,
  internalSlugSetParamsSchema,
} from '@/schemas/internal-slug-set-route';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const FAIL_OPEN: InternalComparePageStatusBody = {
  hasError: true,
  present: false,
};
const INVALID_REQUEST = { error: 'Invalid input', code: 'invalid_input' };

function buildRenderableCacheHeaders(merchantId: string) {
  return {
    'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    Vary: INTERNAL_AUTH_HEADER,
    // The same product/category mutations that change the page's maintained
    // manifest purge this positive verdict. Missing and unknown verdicts stay
    // no-store so a newly published pair cannot be sticky-404ed.
    'Vercel-Cache-Tag': `${getProductSlugSetCacheTag(merchantId)},categories-${merchantId}`,
  } as const;
}

/**
 * Internal compare-pair status endpoint for the proxy's crawl-budget hard 404.
 * It returns only a bounded boolean verdict, never product data. The resolver
 * is deliberately fail-loud; this route converts thrown data/cache failures
 * into `{ hasError: true }`, which the proxy must treat as renderable.
 */
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

  const authMethod = getValidatedInternalAuthMethod(request, expectedSecret);
  if (!authMethod) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }
  const allowEdgeCache = authMethod === 'custom-header';

  const params = internalSlugSetParamsSchema.safeParse(await context.params);
  const query = internalComparePageStatusQuerySchema.safeParse({
    category: request.nextUrl.searchParams.get('category') ?? undefined,
    comparison: request.nextUrl.searchParams.get('comparison') ?? undefined,
  });
  if (!params.success || !query.success) {
    return NextResponse.json(INVALID_REQUEST, {
      status: 400,
      headers: NO_STORE,
    });
  }

  try {
    const status = await resolveComparePageStatus({
      merchantSlug: params.data.identifier,
      categorySlug: query.data.category,
      comparisonSlug: query.data.comparison,
    });

    if (status.kind === 'renderable') {
      const body: InternalComparePageStatusBody = {
        hasError: false,
        present: true,
      };
      return NextResponse.json(body, {
        status: 200,
        headers: allowEdgeCache
          ? buildRenderableCacheHeaders(status.merchantId)
          : NO_STORE,
      });
    }

    const body: InternalComparePageStatusBody = {
      hasError: status.kind === 'unknown',
      present: false,
    };
    return NextResponse.json(body, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error('Internal compare page status resolution failed', { error });
    return NextResponse.json(FAIL_OPEN, { status: 200, headers: NO_STORE });
  }
}
