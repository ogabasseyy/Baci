import { STOREFRONT_SPECIAL_COLLECTION_SLUGS } from '@/lib/storefront-special-collection-slugs';
import {
  STOREFRONT_AUTH_MERCHANT_RPC,
  storefrontAuthMerchantRowSchema,
} from '@/schemas/storefront-preflight-rpc';
import {
  isLoopbackOrigin,
  storefrontInternalPreflight,
} from './storefront-internal-preflight';
import {
  callStorefrontPreflightRpc,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';

const MAX_PUBLICATION_PROBES_IN_FLIGHT = 8;

type ComparePageStatusFastPathResolution =
  | { kind: 'missing' }
  | { kind: 'renderable-or-unknown' };

interface ComparePageStatusFastPathOptions {
  origin: string;
  identifier: string;
  categorySlug: string;
  comparisonIsValid: boolean;
  rpcImpl?: StorefrontPreflightRpcImpl;
  timeoutMs?: number;
}

type ComparePageStatusFastPathFailOpenContext = {
  surface: 'compare-page-status';
  identifier: string;
  slug: string;
};

const publicationProbeInFlight = new Map<string, Promise<boolean>>();

async function isPublishedStorefront(
  opts: ComparePageStatusFastPathOptions,
  failOpenContext: ComparePageStatusFastPathFailOpenContext
): Promise<boolean> {
  const row = await callStorefrontPreflightRpc(
    STOREFRONT_AUTH_MERCHANT_RPC,
    { p_identifier: opts.identifier },
    {
      failOpenContext,
      rpcImpl: opts.rpcImpl,
      timeoutMs: opts.timeoutMs,
      // `resolve_storefront_auth_merchant` returns no row for an unknown
      // identifier. That is expected junk traffic, not a malformed verdict.
      emptyResult: 'unknown',
    }
  );
  if (row === null) {
    return false;
  }

  const parsed = storefrontAuthMerchantRowSchema.safeParse(row);
  if (!parsed.success) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'parse',
    });
    return false;
  }

  if (!parsed.data.is_published) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: 'unknown-storefront',
    });
    return false;
  }

  return true;
}

function isSpecialCollectionCategory(categorySlug: string): boolean {
  return STOREFRONT_SPECIAL_COLLECTION_SLUGS.includes(
    categorySlug as (typeof STOREFRONT_SPECIAL_COLLECTION_SLUGS)[number]
  );
}

function renderableOrUnknown(): ComparePageStatusFastPathResolution {
  return { kind: 'renderable-or-unknown' };
}

async function resolvePublicComparePageStatus(
  opts: ComparePageStatusFastPathOptions
): Promise<ComparePageStatusFastPathResolution | null> {
  if (isLoopbackOrigin(opts.origin)) {
    return null;
  }

  // Valid comparisons and stale product absences are intentionally fail-open:
  // the page loader is authoritative and never hard-404s an uncertain pair.
  // Only the internal resolver's deterministic missing cases are retained.
  if (
    opts.comparisonIsValid &&
    !isSpecialCollectionCategory(opts.categorySlug)
  ) {
    return renderableOrUnknown();
  }

  const failOpenContext = {
    surface: 'compare-page-status' as const,
    identifier: opts.identifier,
    slug: opts.categorySlug,
  };
  const pending = publicationProbeInFlight.get(opts.identifier);
  if (pending) {
    return (await pending) ? { kind: 'missing' } : renderableOrUnknown();
  }

  if (publicationProbeInFlight.size >= MAX_PUBLICATION_PROBES_IN_FLIGHT) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: 'concurrency-limit',
    });
    return renderableOrUnknown();
  }

  const next = isPublishedStorefront(opts, failOpenContext);
  publicationProbeInFlight.set(opts.identifier, next);
  try {
    return (await next) ? { kind: 'missing' } : renderableOrUnknown();
  } finally {
    if (publicationProbeInFlight.get(opts.identifier) === next) {
      publicationProbeInFlight.delete(opts.identifier);
    }
  }
}

function resetStorefrontComparePageStatusFastPathForTests(): void {
  publicationProbeInFlight.clear();
}

export const storefrontComparePageStatusFastPath = {
  resolve: resolvePublicComparePageStatus,
  resetForTests: resetStorefrontComparePageStatusFastPathForTests,
};
