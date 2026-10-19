import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import { getCachedBlogListing } from '@/lib/cached-data';
import { isPreviewPrerenderBuild } from '@/lib/prerender-preview-cap';
import { OGABASSEY_BLOG_STATIC_TENANTS } from '../blog-category-routing';

/**
 * Ceiling on published posts prerendered per static blog tenant. This is a
 * safety cap, not a target: the pager stops at the last listing page, so every
 * published post gets a prerendered PPR shell as long as the tenant stays
 * under this ceiling. Full coverage is load-bearing for SEO, not just LCP —
 * on Vercel, only params enumerated here get a shell with the resolved
 * `<title>` baked into `<head>`; non-enumerated params render with streamed
 * metadata forever (the PPR resume forces streaming regardless of
 * `htmlLimitedBots`), which raw-HTML crawlers read as a missing/wrong title
 * (Semrush 2026-07-10: 64 pages reported as duplicate bare-"Ogabassey"
 * titles). Mirrors the PDP `OGABASSEY_PRERENDER_LIMIT` rationale.
 */
export const BLOG_POST_PRERENDER_LIMIT = 1200;

/**
 * Preview-target ceiling per static blog tenant: one listing page. The full
 * ceiling emits tens of thousands of cold files that never finish the preview
 * finalize step, so preview builds prerender a small newest sample per tenant.
 * Production is unaffected — the gate is an exact `VERCEL_ENV=preview` match.
 */
export const BLOG_POST_PREVIEW_PRERENDER_LIMIT = 12;

// cacheComponents requires generateStaticParams to return >= 1 param. When the
// listing is empty/unavailable at build, this placeholder keeps the build valid
// and renders the streamed soft-not-found body (real, non-listed posts still
// render on demand).
export const BLOG_POST_PRERENDER_PLACEHOLDER_STORE_SLUG =
  '__prerender_placeholder_store__';
export const BLOG_POST_PRERENDER_PLACEHOLDER_POST_SLUG =
  '__prerender_placeholder__';

const PRERENDER_PLACEHOLDER = [
  {
    slug: BLOG_POST_PRERENDER_PLACEHOLDER_STORE_SLUG,
    postSlug: BLOG_POST_PRERENDER_PLACEHOLDER_POST_SLUG,
  },
] as const;

async function collectNewestPublishedPostSlugs(
  tenant: string,
  limit: number
): Promise<string[]> {
  const slugs: string[] = [];
  const totalPages = Math.ceil(limit / BLOG_LISTING_PAGE_SIZE);

  for (let page = 1; page <= totalPages; page += 1) {
    let listing: Awaited<ReturnType<typeof getCachedBlogListing>> = null;
    try {
      listing = await getCachedBlogListing(tenant, { page });
    } catch (error) {
      // A rejected listing lookup at build/prerender time must stop paging for
      // this tenant, not fail the whole prerender step. Surface it (instead of
      // swallowing silently) so a systematically-failing tenant is visible in
      // build logs rather than quietly shipping fewer prerendered posts.
      console.warn('Failed to collect blog post static params for tenant', {
        tenant,
        page,
        error,
      });
      break;
    }

    const posts = listing?.posts ?? [];
    if (posts.length === 0) {
      break;
    }

    for (const post of posts) {
      const postSlug = post.slug?.trim();
      if (postSlug) {
        slugs.push(postSlug);
      }
      if (slugs.length >= limit) {
        return slugs;
      }
    }

    if (posts.length < BLOG_LISTING_PAGE_SIZE) {
      break;
    }
  }

  return slugs;
}

export async function resolveBlogPostStaticParams(): Promise<
  Array<{ slug: string; postSlug: string }>
> {
  const params: Array<{ slug: string; postSlug: string }> = [];
  const seen = new Set<string>();

  // Fetch every tenant's newest-post slugs concurrently — the per-tenant lookups
  // are independent, so paging them serially only adds build latency. Ordering
  // and dedup are preserved by walking the resolved tuples in tenant order.
  const limit = isPreviewPrerenderBuild()
    ? BLOG_POST_PREVIEW_PRERENDER_LIMIT
    : BLOG_POST_PRERENDER_LIMIT;
  const tenantPostSlugs = await Promise.all(
    OGABASSEY_BLOG_STATIC_TENANTS.map(
      async (tenant) =>
        [tenant, await collectNewestPublishedPostSlugs(tenant, limit)] as const
    )
  );

  for (const [tenant, postSlugs] of tenantPostSlugs) {
    for (const postSlug of postSlugs) {
      const key = `${tenant}::${postSlug}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      params.push({ slug: tenant, postSlug });
    }
  }

  return params.length > 0 ? params : [...PRERENDER_PLACEHOLDER];
}
