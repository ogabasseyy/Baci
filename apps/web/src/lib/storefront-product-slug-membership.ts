import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  STOREFRONT_PDP_PREFLIGHT_RPC,
  storefrontPdpPreflightRowSchema,
} from '@/schemas/storefront-preflight-rpc';
import { storefrontInternalPreflight } from './storefront-internal-preflight';
import { buildStorefrontPdpCanonicalPath } from './storefront-pdp-canonical-path';
import {
  callStorefrontPreflightRpc,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';
import { gateStorefrontPreflightStatus } from './storefront-preflight-status-gate';

interface SlugMissingOptions {
  /**
   * Public request origin. Retained so the proxy call sites stay untouched;
   * the direct-RPC transport resolves its own target from the Supabase env.
   */
  origin: string;
  /** Storefront slug or custom domain the proxy has (resolved by the route). */
  identifier: string;
  /** The product slug from the PDP path (`/{category}/{productSlug}`). */
  productSlug: string;
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

export type StorefrontProductSlugResolution =
  | { kind: 'missing' }
  | { kind: 'present-or-unknown' }
  | { kind: 'redirect'; redirectPath: string };

/**
 * Resolves a storefront PDP slug for the proxy: missing slugs become real hard
 * 404s, archived aliases become real 308s, and every uncertain/live case falls
 * through to the App Router.
 *
 * The verdict comes from ONE direct Supabase RPC (`get_storefront_pdp_preflight`
 * — the same call the canonical preflight makes, collapsed by the transport
 * memo into a single round trip per navigation), replacing the
 * /api/internal/slug-set self-fetch whose function-invocation latency tail
 * produced steady timeout fail-opens.
 *
 * Fail-open by construction: a missing secret, transport error, timeout,
 * open circuit breaker, unknown/unpublished storefront, EMPTY catalog (an
 * empty slug set cannot PROVE a slug is absent), malformed row, or unsafe
 * alias redirect all return `present-or-unknown` so the proxy never hard-404s
 * or open-redirects a live product on stale/unavailable data.
 */
export async function resolveStorefrontProductSlugResolution(
  opts: SlugMissingOptions
): Promise<StorefrontProductSlugResolution> {
  const failOpenContext = {
    surface: 'product-slug' as const,
    identifier: opts.identifier,
    slug: opts.productSlug,
  };

  // Unsafe (over-long / repeatedly-encoded) slugs can never be live products,
  // but do NOT hard-404 here: unknown/unpublished storefronts must still
  // render their coming-soon shell instead of a proxy 404. Skip the doomed
  // lookup and fail open, letting the App Router decide.
  const slugSafety = evaluateStorefrontSlugSafety(opts.productSlug);
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
    STOREFRONT_PDP_PREFLIGHT_RPC,
    { p_identifier: opts.identifier, p_product_slug: opts.productSlug },
    {
      failOpenContext,
      rpcImpl: opts.rpcImpl,
      timeoutMs: opts.timeoutMs,
    }
  );
  if (result === null) {
    return { kind: 'present-or-unknown' };
  }

  const parsed = storefrontPdpPreflightRowSchema.safeParse(result.data);
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

  // An empty catalog cannot PROVE a slug is absent (e.g. the first product's
  // publish window). Hard-404ing here would de-index a merchant's first live
  // product — fail open exactly as the slug-set route always has.
  if (!verdict.catalog_nonempty) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'has-error',
    });
    return { kind: 'present-or-unknown' };
  }

  // Hard-404 ONLY on a definitive, error-free "absent" verdict.
  if (!verdict.present) {
    return { kind: 'missing' };
  }

  // Archived alias with a live parent: 308 to the parent's canonical path.
  // An uncomposable/unsafe path downgrades to present-with-no-redirect ("we
  // know it exists, we just won't say where") — never a fail-open capture.
  if (
    verdict.match_kind === 'alias' &&
    verdict.product_id &&
    verdict.product_name
  ) {
    const redirectPath = toSafeInternalRedirectPath(
      buildStorefrontPdpCanonicalPath({
        id: verdict.product_id,
        name: verdict.product_name,
        slug: verdict.product_slug,
        category: verdict.product_category,
        categories: verdict.category_slug
          ? {
              name: verdict.category_name ?? undefined,
              slug: verdict.category_slug,
            }
          : null,
      })
    );
    if (redirectPath) {
      return { kind: 'redirect', redirectPath };
    }
  }

  return { kind: 'present-or-unknown' };
}

/**
 * Compatibility wrapper for callers/tests that only need the hard-404 verdict.
 */
export async function isStorefrontProductSlugMissing(
  opts: SlugMissingOptions
): Promise<boolean> {
  const resolution = await resolveStorefrontProductSlugResolution(opts);
  return resolution.kind === 'missing';
}
