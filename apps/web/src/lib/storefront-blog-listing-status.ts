import { getBlogAuthorBySlug } from '@/lib/blog-authors';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  STOREFRONT_BLOG_LISTING_STATUS_RPC,
  storefrontBlogListingStatusRowSchema,
} from '@/schemas/storefront-preflight-rpc';
import type { BlogListingStatusIntent } from './cached-storefront-blog-listing-status';
import {
  resolveBlogListingVerdict,
  type StorefrontBlogListingStatusResolution,
} from './storefront-blog-listing-verdict';
import { storefrontInternalPreflight } from './storefront-internal-preflight';
import {
  callStorefrontPreflightRpc,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';
import { gateStorefrontPreflightStatus } from './storefront-preflight-status-gate';

export type { StorefrontBlogListingStatusResolution };

interface BlogListingStatusOptions {
  /**
   * Public request origin. Retained so the proxy call sites stay untouched; the
   * direct-RPC transport resolves its own target from the Supabase env.
   */
  origin: string;
  /** Storefront slug or custom domain resolved by the proxy. */
  identifier: string;
  /** Parsed listing/category/author intent from the pathname + query. */
  intent: BlogListingStatusIntent;
  /**
   * `INTERNAL_API_SECRET`; when absent the check is a no-op. Kept as the
   * operational kill-switch: unsetting the secret disables every preflight
   * without a deploy.
   */
  secret: string | undefined;
  /** Injectable for tests. */
  rpcImpl?: StorefrontPreflightRpcImpl;
  /** Tight budget — a slow verdict must not delay navigations. */
  timeoutMs?: number;
}

function getIntentLogSlug(intent: BlogListingStatusIntent): string {
  switch (intent.kind) {
    case 'category-query':
      return intent.category;
    case 'listing-page':
      return intent.category
        ? `${intent.category}:page-${intent.page}`
        : `page-${intent.page}`;
    case 'category-page':
      return `${intent.categorySlug}:page-${intent.page}`;
    case 'author':
      return `${intent.authorSlug}:page-${intent.page}`;
  }
}

/**
 * The free-text, user-controlled segment of an intent — the value that carries
 * bot-supplied percent-encoding. `page` is a bounded integer, so page-only
 * listing intents have no unsafe segment (returns null → always safe).
 */
function getIntentUserSlug(intent: BlogListingStatusIntent): string | null {
  switch (intent.kind) {
    case 'category-query':
      return intent.category;
    case 'listing-page':
      return intent.category ?? null;
    case 'category-page':
      return intent.categorySlug;
    case 'author':
      return intent.authorSlug;
  }
}

/**
 * Resolves the hard status of a storefront blog listing/category/author URL for
 * the proxy: known `?category=` canonicalizes to a clean hub (308), out-of-range
 * pagination clamps to the last real page (307), a known author with zero posts
 * becomes a real 404, and live/uncertain cases fall through to the App Router.
 *
 * The verdict comes from ONE direct Supabase RPC
 * (`get_storefront_blog_listing_status`), replacing the
 * /api/internal/blog-listing-status self-fetch whose function-invocation
 * latency tail produced steady timeout fail-opens. The RPC returns only raw
 * listing data; every href, page clamp, and category-label match is composed
 * here in TS with the same helpers the routes use — exactly as the resolver did
 * from `getCachedBlogListing`/`getCachedBlogAuthor`.
 *
 * Fail-open by construction: a missing secret, transport error, timeout, open
 * circuit breaker, unknown/unpublished storefront, or malformed row all return
 * `noop`.
 */
export async function resolveStorefrontBlogListingStatus(
  opts: BlogListingStatusOptions
): Promise<StorefrontBlogListingStatusResolution> {
  const failOpenContext = {
    surface: 'blog-listing-status' as const,
    identifier: opts.identifier,
    slug: getIntentLogSlug(opts.intent),
  };

  // Unsafe (over-long / repeatedly-encoded) category/author segments can never
  // match a listing; skip the lookup and let the App Router resolve it.
  const userSlug = getIntentUserSlug(opts.intent);
  if (userSlug !== null) {
    const slugSafety = evaluateStorefrontSlugSafety(userSlug);
    if (!slugSafety.safe) {
      storefrontInternalPreflight.warnSkip({
        ...failOpenContext,
        reason: slugSafety.reason,
      });
      return { kind: 'noop' };
    }
  }

  if (!opts.secret) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-secret',
    });
    return { kind: 'noop' };
  }

  // The author intent's profile lookup stays in TS (a static registry, not a DB
  // table). Resolve it BEFORE the RPC so a non-author URL skips the round trip
  // entirely and the DB only counts the resolved canonical author name.
  let authorName = '';
  if (opts.intent.kind === 'author') {
    const profile = getBlogAuthorBySlug(
      opts.intent.authorSlug.toLowerCase(),
      opts.identifier
    );
    if (!profile) {
      // Unknown author is resolved before the shell in the route; fall through.
      return { kind: 'noop' };
    }
    authorName = profile.name;
  }

  const result = await callStorefrontPreflightRpc(
    STOREFRONT_BLOG_LISTING_STATUS_RPC,
    { p_identifier: opts.identifier, p_author_name: authorName },
    {
      failOpenContext,
      rpcImpl: opts.rpcImpl,
      timeoutMs: opts.timeoutMs,
    }
  );
  if (result === null) {
    return { kind: 'noop' };
  }

  const parsed = storefrontBlogListingStatusRowSchema.safeParse(result.data);
  if (!parsed.success) {
    if (result.attempt) {
      storefrontInternalPreflight.warnRpcFailOpen(
        failOpenContext,
        result.attempt,
        'parse'
      );
    } else {
      storefrontInternalPreflight.warnFailOpen({
        ...failOpenContext,
        reason: 'parse',
      });
    }
    return { kind: 'noop' };
  }
  const verdict = parsed.data;

  if (
    !gateStorefrontPreflightStatus(verdict.storefront_status, failOpenContext)
  ) {
    return { kind: 'noop' };
  }

  return resolveBlogListingVerdict(opts.intent, verdict);
}
