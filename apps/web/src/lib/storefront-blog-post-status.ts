import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  STOREFRONT_BLOG_POST_STATUS_RPC,
  storefrontBlogPostStatusRowSchema,
} from '@/schemas/storefront-preflight-rpc';
import { storefrontInternalPreflight } from './storefront-internal-preflight';
import {
  callStorefrontPreflightRpc,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';
import { gateStorefrontPreflightStatus } from './storefront-preflight-status-gate';

interface BlogPostStatusOptions {
  /**
   * Public request origin. Retained so the proxy call sites stay untouched;
   * the direct-RPC transport resolves its own target from the Supabase env.
   */
  origin: string;
  /** Storefront slug or custom domain resolved by the proxy. */
  identifier: string;
  /** Blog post slug from `/blog/{postSlug}`. */
  postSlug: string;
  /**
   * `INTERNAL_API_SECRET`; when absent the check fails open. Kept as the
   * operational kill-switch: unsetting the secret disables every preflight
   * without a deploy.
   */
  secret: string | undefined;
  /** Injectable for tests. */
  rpcImpl?: StorefrontPreflightRpcImpl;
  /** Tight budget — a slow verdict must not delay navigations. */
  timeoutMs?: number;
}

export type StorefrontBlogPostStatusResolution =
  | { kind: 'missing' }
  | { kind: 'present-or-unknown' }
  | { kind: 'redirect'; redirectPath: string };

/**
 * Resolves the hard status of a storefront blog-post URL for the proxy:
 * retired slugs become real 308s to the target post's CURRENT slug, dead
 * slugs (including blog-disabled storefronts) become real 404s, and live or
 * uncertain cases fall through to the App Router.
 *
 * The verdict comes from ONE direct Supabase RPC
 * (`get_storefront_blog_post_status`), replacing the
 * /api/internal/blog-post-status self-fetch whose function-invocation latency
 * tail produced steady timeout fail-opens. The redirect path is composed and
 * safety-validated here in TS, exactly as the resolver did.
 *
 * Fail-open by construction: a missing secret, transport error, timeout, open
 * circuit breaker, unknown/unpublished storefront, or malformed row all
 * return `present-or-unknown`.
 */
export async function resolveStorefrontBlogPostStatus(
  opts: BlogPostStatusOptions
): Promise<StorefrontBlogPostStatusResolution> {
  const failOpenContext = {
    surface: 'blog-post-status' as const,
    identifier: opts.identifier,
    slug: opts.postSlug,
  };

  // Unsafe (over-long / repeatedly-encoded) slugs can never be live posts, but
  // do NOT hard-404 here: unknown/unpublished storefronts must still render
  // their coming-soon shell instead of a proxy 404. Skip the doomed lookup and
  // fail open, letting the App Router decide.
  const slugSafety = evaluateStorefrontSlugSafety(opts.postSlug);
  if (!slugSafety.safe) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: slugSafety.reason,
    });
    return { kind: 'present-or-unknown' };
  }

  if (!opts.secret) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-secret',
    });
    return { kind: 'present-or-unknown' };
  }

  const result = await callStorefrontPreflightRpc(
    STOREFRONT_BLOG_POST_STATUS_RPC,
    { p_identifier: opts.identifier, p_post_slug: opts.postSlug },
    {
      failOpenContext,
      rpcImpl: opts.rpcImpl,
      timeoutMs: opts.timeoutMs,
    }
  );
  if (result === null) {
    return { kind: 'present-or-unknown' };
  }

  const parsed = storefrontBlogPostStatusRowSchema.safeParse(result.data);
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
    return { kind: 'present-or-unknown' };
  }
  const verdict = parsed.data;

  if (
    !gateStorefrontPreflightStatus(verdict.storefront_status, failOpenContext)
  ) {
    return { kind: 'present-or-unknown' };
  }

  // Blog feature disabled (or never configured — the public default) means no
  // blog URL can be live: real 404, exactly as the resolver returned MISSING.
  if (!verdict.blog_enabled) {
    return { kind: 'missing' };
  }

  if (verdict.live_present) {
    return { kind: 'present-or-unknown' };
  }

  const targetSlug = verdict.redirect_target_slug?.trim().toLowerCase() ?? '';
  const sourceSlug = opts.postSlug.trim().toLowerCase();
  if (targetSlug && targetSlug !== sourceSlug) {
    const redirectPath = toSafeInternalRedirectPath(`/blog/${targetSlug}`);
    if (redirectPath) {
      return { kind: 'redirect', redirectPath };
    }
    // A live target whose composed path fails validation is a data-quality
    // incident, not a provable absence — fail open (resolver parity).
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'has-error',
    });
    return { kind: 'present-or-unknown' };
  }

  // No live post and no (usable) redirect: definitive absent -> hard 404.
  return { kind: 'missing' };
}
