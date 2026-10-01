import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import {
  STOREFRONT_PDP_PREFLIGHT_RPC,
  storefrontPdpPreflightRowSchema,
} from '@/schemas/storefront-preflight-rpc';
import { storefrontInternalPreflight } from './storefront-internal-preflight';
import {
  buildStorefrontPdpCanonicalPath,
  normalizeStorefrontPdpPathForCompare,
} from './storefront-pdp-canonical-path';
import {
  callStorefrontPreflightRpc,
  gateStorefrontPreflightStatus,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';

// Production query stats show rare `get_storefront_pdp_preflight` tails just
// below the anon role's 3s statement-timeout ceiling. PostgreSQL starts that
// clock when the command reaches the server, so reserve 1s for the request and
// PostgREST response while keeping the broader preflight budget at 2s.
const PRODUCT_CANONICAL_DEFAULT_TIMEOUT_MS = 4_000;

interface ProductCanonicalRedirectOptions {
  /**
   * Public request origin. Retained so the proxy call sites stay untouched;
   * the direct-RPC transport resolves its own target from the Supabase env.
   */
  origin: string;
  /** Storefront slug or custom domain resolved by the proxy. */
  identifier: string;
  /** First public PDP path segment, usually the category slug. */
  category: string;
  /** Product slug from the public PDP path. */
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

export type StorefrontProductCanonicalRedirectResult =
  | { kind: 'redirect'; redirectPath: string }
  | { kind: 'checked-no-redirect' }
  | { kind: 'unknown' };

/**
 * Canonical PDP redirect preflight for stale category aliases, archived
 * variant slugs, and legacy `/{category}/{productId}` links. Runs in the proxy
 * before the App Router/PPR page streams so crawlers get a real 308 instead of
 * a streamed shell.
 *
 * The verdict comes from ONE direct Supabase RPC
 * (`get_storefront_pdp_preflight` — shared with the slug-membership preflight
 * and collapsed by the transport memo into a single round trip per
 * navigation), replacing the /api/internal/product-canonical self-fetch whose
 * function-invocation latency tail produced steady timeout fail-opens. The
 * canonical target path is composed here in TS from the row's product fields
 * via the same helper the internal route uses, so proxy 308 targets can never
 * drift from the route (rollback path) or the page's own canonicalization.
 */
export async function getStorefrontProductCanonicalRedirectResult(
  opts: ProductCanonicalRedirectOptions
): Promise<StorefrontProductCanonicalRedirectResult> {
  const failOpenContext = {
    surface: 'product-canonical' as const,
    identifier: opts.identifier,
    slug: opts.productSlug,
  };

  // Unsafe (over-long / repeatedly-encoded) path segments can never resolve to
  // a canonical product URL; skip the lookup and fall through to the
  // App Router. Both segments feed the comparison, so both must pass the gate.
  const slugSafety = evaluateStorefrontSlugSafety(opts.productSlug);
  const categorySafety = evaluateStorefrontSlugSafety(opts.category);
  const unsafeReason = !slugSafety.safe
    ? slugSafety.reason
    : !categorySafety.safe
      ? categorySafety.reason
      : null;
  if (unsafeReason) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: unsafeReason,
    });
    return { kind: 'unknown' };
  }

  if (!opts.secret) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-secret',
    });
    return { kind: 'unknown' };
  }

  const row = await callStorefrontPreflightRpc(
    STOREFRONT_PDP_PREFLIGHT_RPC,
    { p_identifier: opts.identifier, p_product_slug: opts.productSlug },
    {
      failOpenContext,
      rpcImpl: opts.rpcImpl,
      timeoutMs: opts.timeoutMs ?? PRODUCT_CANONICAL_DEFAULT_TIMEOUT_MS,
    }
  );
  if (row === null) {
    return { kind: 'unknown' };
  }

  const parsed = storefrontPdpPreflightRowSchema.safeParse(row);
  if (!parsed.success) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'parse',
    });
    return { kind: 'unknown' };
  }
  const verdict = parsed.data;

  if (
    !gateStorefrontPreflightStatus(verdict.storefront_status, failOpenContext)
  ) {
    return { kind: 'unknown' };
  }

  // No active product or live alias matched this slug: NOT a hard-404 verdict
  // here — the caller keeps `skipHardNotFound=false` so the membership
  // preflight (same memoized RPC snapshot) makes the real absent decision.
  if (
    (verdict.match_kind !== 'active' && verdict.match_kind !== 'alias') ||
    !verdict.product_id ||
    !verdict.product_name
  ) {
    return { kind: 'unknown' };
  }

  const targetPath = buildStorefrontPdpCanonicalPath({
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
  });

  const requestedPath = `/${opts.category}/${opts.productSlug}`;
  if (
    normalizeStorefrontPdpPathForCompare(targetPath) ===
    normalizeStorefrontPdpPathForCompare(requestedPath)
  ) {
    return { kind: 'checked-no-redirect' };
  }

  const redirectPath = toSafeInternalRedirectPath(targetPath);
  if (!redirectPath) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'unsafe-redirect',
    });
    return { kind: 'unknown' };
  }

  return { kind: 'redirect', redirectPath };
}

/**
 * Compatibility wrapper for callers/tests that only need the redirect path.
 */
export async function getStorefrontProductCanonicalRedirectPath(
  opts: ProductCanonicalRedirectOptions
): Promise<string | null> {
  const result = await getStorefrontProductCanonicalRedirectResult(opts);
  return result.kind === 'redirect' ? result.redirectPath : null;
}
