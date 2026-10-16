import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type MerchantFeatureSource,
  merchantHasFeature,
} from '@/lib/merchant-has-feature';
import {
  isSlugShapedIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

import { storefrontAuthMerchantRpcRowSchema } from '@/schemas/storefront-auth-merchant';

import {
  isHintPlatformHost,
  isSharedPlatformHost,
  normalizeHeader,
  requestHost,
} from './merchant-host';
import type { CartMerchantContext } from './principal';

export {
  isPrivateLanHost,
  normalizeHeader,
  normalizeHost,
  requestHost,
} from './merchant-host';

export interface CartRouteMerchant extends CartMerchantContext {
  customDomain: string | null;
}

export type MerchantResolutionError =
  | 'merchant_unresolved'
  | 'merchant_unavailable'
  | 'temporarily_unavailable';

export interface MerchantRpcClient {
  rpc(
    functionName: 'resolve_storefront_auth_merchant',
    args: { p_identifier: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ResolveCartMerchantDeps {
  rpcClient: MerchantRpcClient;
  resolveAlias: (slug: string) => Promise<string | null>;
  rootDomain?: string;
  /** Pre-parsed merchantSlug hint from the JSON body, if any. */
  bodyHint?: string | null;
  /**
   * Shared-cart enrollment lookup. When provided, resolution fails
   * closed unless the merchant carries the shared_cart feature, so the
   * pilot gate holds on the server even where the UI hides the feature.
   * Cart routes always provide it; other callers may omit it.
   */
  loadMerchantFeatures?: (
    merchantId: string
  ) => Promise<MerchantFeatureSource | null>;
}

/**
 * Enrollment lookup backed by the public merchants read (the same
 * feature fields the storefront shell already receives client-side).
 */
export function createAnonMerchantFeatureLookup(
  client: SupabaseClient
): NonNullable<ResolveCartMerchantDeps['loadMerchantFeatures']> {
  return async (merchantId: string) => {
    const { data, error } = await client
      .from('merchants')
      .select('premium_features, plan_tier, plan_expires_at')
      .eq('id', merchantId)
      .maybeSingle();
    if (error) {
      throw new Error('merchant feature lookup failed', { cause: error });
    }
    return (data as MerchantFeatureSource | null) ?? null;
  };
}

export type ResolveCartMerchantResult =
  | { ok: true; merchant: CartRouteMerchant }
  | { error: MerchantResolutionError; ok: false };

export const MERCHANT_HINT_QUERY_PARAMS = [
  'merchantSlug',
  'merchant_slug',
  'merchant',
] as const;

/**
 * Proxies set merchant headers authoritatively, but a route must still
 * cross-check them against the request Host: a client can send any
 * header to any host. Mirrors the shipping-quote trust rule. Forwarded
 * host headers are never consulted.
 */
export function trustedProxyIdentifier(
  request: Request,
  rootDomain: string
): string | null {
  const host = requestHost(request);
  const slug = normalizeHeader(request.headers.get('x-merchant-slug'));
  const domain = normalizeHeader(
    request.headers.get('x-merchant-domain') ??
      request.headers.get('x-custom-domain')
  );

  if (domain && (host === domain || host === `www.${domain}`)) {
    return domain;
  }
  if (
    slug &&
    (host === `${slug}.${rootDomain}` ||
      host === `${slug}.localhost` ||
      host.startsWith(`${slug}.localhost:`))
  ) {
    return slug;
  }
  return null;
}

export function queryHint(request: Request): string | null {
  const url = new URL(request.url);
  for (const param of MERCHANT_HINT_QUERY_PARAMS) {
    const value = url.searchParams.get(param)?.trim().toLowerCase();
    if (value) return value;
  }
  return null;
}

export async function resolvePublished(
  rpcClient: MerchantRpcClient,
  identifier: string
): Promise<
  | { merchant: CartRouteMerchant; ok: true }
  | { error: 'merchant_unresolved' | 'merchant_unavailable'; ok: false }
> {
  const { data, error } = await rpcClient.rpc(
    'resolve_storefront_auth_merchant',
    { p_identifier: identifier }
  );
  if (error) {
    throw new Error('merchant lookup failed', { cause: error });
  }
  const firstRow = Array.isArray(data) ? data[0] : null;
  const parsed = storefrontAuthMerchantRpcRowSchema.safeParse(firstRow);
  if (!parsed.success) {
    return { error: 'merchant_unresolved', ok: false };
  }
  if (!parsed.data.is_published) {
    return { error: 'merchant_unavailable', ok: false };
  }
  return {
    merchant: {
      customDomain: parsed.data.custom_domain,
      id: parsed.data.id,
      slug: parsed.data.slug,
    },
    ok: true,
  };
}

/**
 * Trusted merchant resolution for cart routes. Proxy headers win when
 * they match the request Host; otherwise a slug/domain hint from the
 * query string or body is resolved through the established
 * published-store mapping plus the retired-slug alias table. Only
 * published stores resolve; client input never overrides the host.
 */
export async function resolveCartMerchant(
  request: Request,
  deps: ResolveCartMerchantDeps
): Promise<ResolveCartMerchantResult> {
  const rootDomain = (
    deps.rootDomain ??
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    'usebaci.com'
  ).toLowerCase();
  const trusted = trustedProxyIdentifier(request, rootDomain);
  const host = requestHost(request);
  const sharedHost = isSharedPlatformHost(host, rootDomain);
  const hostIdentifier = sharedHost
    ? null
    : host.endsWith(`.${rootDomain}`)
      ? host.slice(0, -rootDomain.length - 1)
      : host.endsWith('.localhost')
        ? host.slice(0, -'.localhost'.length)
        : host.replace(/^www\./, '');
  const resolveForHost = async (
    identifier: string,
    requestedIdentifier?: string
  ): Promise<ResolveCartMerchantResult> => {
    const resolved = await resolvePublished(deps.rpcClient, identifier);
    if (!resolved.ok || sharedHost) return resolved;
    const merchant = resolved.merchant;
    const domain = merchant.customDomain?.toLowerCase();
    if (
      host === `${merchant.slug}.${rootDomain}` ||
      host === `${merchant.slug}.localhost` ||
      (domain && (host === domain || host === `www.${domain}`))
    )
      return resolved;
    // A retired slug still routes to this merchant (the alias table is
    // merchant-owned server data recorded at rename time), and shoppers
    // may still be on the old host: cookies are namespaced by merchant
    // id, so the rename must not orphan their carts. The alias host is
    // therefore as authoritative as the canonical one — but only the
    // identifier that actually resolved through the alias may vouch
    // for the host, never an arbitrary hint.
    if (
      requestedIdentifier !== undefined &&
      requestedIdentifier !== merchant.slug &&
      (host === `${requestedIdentifier}.${rootDomain}` ||
        host === `${requestedIdentifier}.localhost`)
    )
      return resolved;
    return { error: 'merchant_unresolved', ok: false };
  };
  const withEnrollment = async (
    result: ResolveCartMerchantResult
  ): Promise<ResolveCartMerchantResult> => {
    if (!result.ok || !deps.loadMerchantFeatures) return result;
    const features = await deps.loadMerchantFeatures(result.merchant.id);
    if (!features) return { error: 'temporarily_unavailable', ok: false };
    if (!merchantHasFeature(features, 'shared_cart')) {
      return { error: 'merchant_unavailable', ok: false };
    }
    return result;
  };
  // Client hints may select a tenant only on the native API hosts
  // (or non-production dev hosts); on browsable shared hosts the
  // host itself must identify the merchant.
  const hintAllowed = isHintPlatformHost(host, rootDomain);
  const hint =
    trusted ??
    hostIdentifier ??
    (hintAllowed
      ? (queryHint(request) ?? deps.bodyHint?.trim().toLowerCase() ?? null)
      : null);
  if (!hint) {
    return { error: 'merchant_unresolved', ok: false };
  }

  try {
    if (trusted) {
      const direct = await resolveForHost(trusted);
      if (direct.ok || direct.error === 'merchant_unavailable') {
        return await withEnrollment(direct);
      }
      // The proxy header may carry a retired slug (it mirrors the host
      // the shopper actually used); fall through the alias table just
      // like the host-derived path below.
      if (isSlugShapedIdentifier(trusted)) {
        const current = await deps.resolveAlias(trusted);
        if (current && current !== trusted) {
          return await withEnrollment(await resolveForHost(current, trusted));
        }
      }
      return await withEnrollment(direct);
    }
    if (!isValidMerchantIdentifier(hint)) {
      if (isSlugShapedIdentifier(hint)) {
        const current = await deps.resolveAlias(hint);
        if (current && current !== hint) {
          return await withEnrollment(await resolveForHost(current, hint));
        }
      }
      return { error: 'merchant_unresolved', ok: false };
    }
    const resolved = await withEnrollment(await resolveForHost(hint));
    if (resolved.ok || resolved.error === 'merchant_unavailable') {
      return resolved;
    }
    const current = await deps.resolveAlias(hint);
    if (current && current !== hint) {
      return await withEnrollment(await resolveForHost(current, hint));
    }
    return { error: 'merchant_unresolved', ok: false };
  } catch {
    return { error: 'temporarily_unavailable', ok: false };
  }
}
