import { type NextRequest, NextResponse } from 'next/server';
import { getInternalApiSecret } from '@/env';
import {
  type BlogListingStatusBody,
  getCachedStorefrontBlogListingStatus,
} from '@/lib/cached-storefront-blog-listing-status';
import {
  getValidatedInternalAuthMethod,
  INTERNAL_AUTH_HEADER,
} from '@/lib/internal-auth-header';
import { getBlogListingStatusCacheTag } from '@/lib/tenant-cache-tags';
import {
  internalBlogListingStatusQuerySchema,
  internalSlugSetParamsSchema,
} from '@/schemas/internal-slug-set-route';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
// Same cacheable-verdict mechanics as the blog-post-status preflight: the
// proxy authenticates via `x-baci-internal-auth` (an `Authorization` header
// makes a response ineligible for Vercel's CDN cache) and `Vary` keys the edge
// entry to the secret value. Only the definitive NOOP verdict ("render
// normally": no redirect, no notFound) is cached — it is self-healing (the
// route still clamps/404s a since-changed listing itself). Redirect, notFound,
// and fail-open verdicts stay no-store so a changed page count or category is
// never sticky for the TTL window. The `Vercel-Cache-Tag` matches the
// identifier-scoped `blog-listing-status-${identifier}` tag invalidated by
// `revalidateBlogPosts` and carried by `getCachedStorefrontBlogListingStatus`,
// so any post/category change purges this tenant's CDN entries immediately
// without busting unrelated storefronts.
const PREFLIGHT_CACHE = {
  'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
  Vary: INTERNAL_AUTH_HEADER,
} as const;
// Typed against the shared contract so a shape change fails at compile time.
const FAIL_OPEN: BlogListingStatusBody = {
  hasError: true,
  redirectPath: null,
  permanent: false,
  notFound: false,
};
const INVALID_REQUEST = { error: 'Invalid input', code: 'invalid_input' };

function isCacheableNoopVerdict(result: BlogListingStatusBody): boolean {
  return (
    result.hasError === false &&
    result.redirectPath === null &&
    result.notFound === false &&
    // The unknown/unpublished-storefront NOOP must never stick: publish-state
    // changes purge merchant tags only (never `blog-posts`), so a cached
    // pre-publish NOOP would suppress listing redirects/clamps after the store
    // goes live until the entry's natural TTL.
    result.unpublishedStorefront !== true
  );
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
  const searchParams = request.nextUrl.searchParams;
  const query = internalBlogListingStatusQuerySchema.safeParse({
    kind: searchParams.get('kind'),
    category: searchParams.get('category') ?? undefined,
    categorySlug: searchParams.get('categorySlug') ?? undefined,
    authorSlug: searchParams.get('authorSlug') ?? undefined,
    page: searchParams.get('page') ?? undefined,
  });
  if (!params.success || !query.success) {
    return NextResponse.json(INVALID_REQUEST, {
      status: 400,
      headers: NO_STORE,
    });
  }

  try {
    const result = await getCachedStorefrontBlogListingStatus(
      params.data.identifier,
      query.data
    );
    return NextResponse.json(result, {
      status: 200,
      headers:
        allowEdgeCache && isCacheableNoopVerdict(result)
          ? {
              ...PREFLIGHT_CACHE,
              'Vercel-Cache-Tag': getBlogListingStatusCacheTag(
                params.data.identifier
              ),
            }
          : NO_STORE,
    });
  } catch (error) {
    console.error('Internal blog listing status resolution failed', { error });
    return NextResponse.json(FAIL_OPEN, { status: 200, headers: NO_STORE });
  }
}
