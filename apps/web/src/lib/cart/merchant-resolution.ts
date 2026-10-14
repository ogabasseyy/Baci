import {
  isSlugShapedIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

import { storefrontAuthMerchantRpcRowSchema } from '@/schemas/storefront-auth-merchant';

import type { CartMerchantContext } from './principal';

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
}

export type ResolveCartMerchantResult =
  | { ok: true; merchant: CartRouteMerchant }
  | { error: MerchantResolutionError; ok: false };

export const MERCHANT_HINT_QUERY_PARAMS = [
  'merchantSlug',
  'merchant_slug',
  'merchant',
] as const;

export function normalizeHost(value: string | null): string {
  return (value ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
}

export function requestHost(request: Request): string {
  const header = normalizeHost(request.headers.get('host'));
  if (header) return header;
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeHeader(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

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
  const sharedHost =
    host === rootDomain ||
    host === `www.${rootDomain}` ||
    host === 'localhost' ||
    host === '127.0.0.1';
  const hostIdentifier = sharedHost
    ? null
    : host.endsWith(`.${rootDomain}`)
      ? host.slice(0, -rootDomain.length - 1)
      : host.endsWith('.localhost')
        ? host.slice(0, -'.localhost'.length)
        : host.replace(/^www\./, '');
  const resolveForHost = async (
    identifier: string
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
    return { error: 'merchant_unresolved', ok: false };
  };
  const hint =
    trusted ??
    hostIdentifier ??
    queryHint(request) ??
    deps.bodyHint?.trim().toLowerCase() ??
    null;
  if (!hint) {
    return { error: 'merchant_unresolved', ok: false };
  }

  try {
    if (trusted) {
      return await resolveForHost(trusted);
    }
    if (!isValidMerchantIdentifier(hint)) {
      if (isSlugShapedIdentifier(hint)) {
        const current = await deps.resolveAlias(hint);
        if (current && current !== hint) {
          return await resolveForHost(current);
        }
      }
      return { error: 'merchant_unresolved', ok: false };
    }
    const resolved = await resolveForHost(hint);
    if (resolved.ok || resolved.error === 'merchant_unavailable') {
      return resolved;
    }
    const current = await deps.resolveAlias(hint);
    if (current && current !== hint) {
      return await resolveForHost(current);
    }
    return { error: 'merchant_unresolved', ok: false };
  } catch {
    return { error: 'temporarily_unavailable', ok: false };
  }
}
