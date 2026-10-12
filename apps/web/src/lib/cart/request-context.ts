import { createHash } from 'node:crypto';
import { getRedis } from '@/lib/redis';
import {
  isSlugShapedIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { storefrontAuthMerchantRpcRowSchema } from '@/schemas/storefront-auth-merchant';
import {
  type CartMerchantContext,
  type CartPrincipal,
  readCookieFromRequest,
  resolveCartPrincipal,
} from './principal';
import type { CartRouteErrorCode } from './response';
import {
  CART_SESSION_PROOF_VERSION,
  CartSessionConfigError,
  type CartSessionVerification,
} from './session-proof';

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

const MERCHANT_HINT_QUERY_PARAMS = [
  'merchantSlug',
  'merchant_slug',
  'merchant',
] as const;

function normalizeHost(value: string | null): string {
  return (value ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
}

function requestHost(request: Request): string {
  const header = normalizeHost(request.headers.get('host'));
  if (header) return header;
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeHeader(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/**
 * Proxies set merchant headers authoritatively, but a route must still
 * cross-check them against the request Host: a client can send any
 * header to any host. Mirrors the shipping-quote trust rule. Forwarded
 * host headers are never consulted.
 */
function trustedProxyIdentifier(
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

function queryHint(request: Request): string | null {
  const url = new URL(request.url);
  for (const param of MERCHANT_HINT_QUERY_PARAMS) {
    const value = url.searchParams.get(param)?.trim().toLowerCase();
    if (value) return value;
  }
  return null;
}

async function resolvePublished(
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
  const hint =
    trusted ??
    queryHint(request) ??
    deps.bodyHint?.trim().toLowerCase() ??
    null;
  if (!hint) {
    return { error: 'merchant_unresolved', ok: false };
  }

  try {
    if (trusted) {
      return await resolvePublished(deps.rpcClient, trusted);
    }
    if (!isValidMerchantIdentifier(hint)) {
      if (isSlugShapedIdentifier(hint)) {
        const current = await deps.resolveAlias(hint);
        if (current && current !== hint) {
          return await resolvePublished(deps.rpcClient, current);
        }
      }
      return { error: 'merchant_unresolved', ok: false };
    }
    const resolved = await resolvePublished(deps.rpcClient, hint);
    if (resolved.ok || resolved.error === 'merchant_unavailable') {
      return resolved;
    }
    const current = await deps.resolveAlias(hint);
    if (current && current !== hint) {
      return await resolvePublished(deps.rpcClient, current);
    }
    return { error: 'merchant_unresolved', ok: false };
  } catch {
    return { error: 'temporarily_unavailable', ok: false };
  }
}

/**
 * Native clients present the cart proof as `Authorization: Bearer cp1…`
 * (secure device storage); browsers use the merchant-namespaced cookie.
 * Only cp1-prefixed Bearer values are cart proofs — Supabase JWTs and
 * other schemes fall through to the cookie, so account credentials
 * never enter the cart flow.
 */
export type ReadCartJsonBodyResult =
  | { body: unknown; ok: true }
  | { ok: false };

/**
 * Lenient JSON body reader: an absent body parses as an empty object so
 * bootstrap accepts bare POSTs, while malformed JSON fails without
 * throwing. Strict Zod schemas still reject unexpected shapes.
 */
export async function readCartJsonBody(
  request: Request
): Promise<ReadCartJsonBodyResult> {
  const text = await request.text();
  if (!text.trim()) {
    return { body: {}, ok: true };
  }
  try {
    return { body: JSON.parse(text) as unknown, ok: true };
  } catch {
    return { ok: false };
  }
}

export function readCartProofFromRequest(
  request: Request,
  cookieName: string
): string | null {
  const header = request.headers.get('authorization');
  const bearer = header?.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]?.trim();
  if (bearer?.startsWith(`${CART_SESSION_PROOF_VERSION}.`)) {
    return bearer;
  }
  return readCookieFromRequest(request, cookieName);
}

export interface CartRequestContextDeps {
  merchant: ResolveCartMerchantDeps;
  verify: (
    proof: string
  ) => CartSessionVerification | Promise<CartSessionVerification>;
  requireScope: 'bootstrap' | 'session';
  /**
   * Route-specific outcome when the proof scope does not fit: session
   * routes report a missing cart for bootstrap proofs, while the
   * creation route forbids session proofs.
   */
  wrongScopeError: CartRouteErrorCode;
}

export type CartRequestContextResult =
  | { ok: true; merchant: CartRouteMerchant; principal: CartPrincipal }
  | { error: CartRouteErrorCode; ok: false };

/**
 * Builds route authority from trusted merchant resolution plus a
 * verified session proof. Missing proof configuration fails closed
 * with a retryable code; unexpected faults propagate to the route's
 * catch-all so they are logged, never leaked.
 */
export async function resolveCartRequestContext(
  request: Request,
  deps: CartRequestContextDeps
): Promise<CartRequestContextResult> {
  const merchant = await resolveCartMerchant(request, deps.merchant);
  if (!merchant.ok) {
    return merchant;
  }

  let principal: CartPrincipal;
  try {
    const resolved = await resolveCartPrincipal(request, {
      readProof: (candidate, cookieName) =>
        readCartProofFromRequest(candidate, cookieName),
      resolveMerchant: async () => merchant.merchant,
      verify: async (proof) => deps.verify(proof),
    });
    if (!resolved.ok) {
      return resolved;
    }
    principal = resolved.principal;
  } catch (error) {
    if (error instanceof CartSessionConfigError) {
      return { error: 'temporarily_unavailable', ok: false };
    }
    throw error;
  }

  if (principal.scope !== deps.requireScope) {
    return { error: deps.wrongScopeError, ok: false };
  }
  return { merchant: merchant.merchant, ok: true, principal };
}

export type CartQuotaOperation =
  | 'bootstrap'
  | 'create'
  | 'commands'
  | 'snapshot';

export interface CartQuotaInput {
  operation: CartQuotaOperation;
  merchantId: string;
  /** Principal id once known, otherwise the client identifier. */
  subject: string;
}

export interface CartQuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

const CART_QUOTA_BUDGETS: Record<
  CartQuotaOperation,
  { limit: number; windowMs: number }
> = {
  // Anonymous bootstrap is the unauthenticated creation vector: bounded
  // per merchant and client, on top of the proxy per-IP rate limit.
  bootstrap: { limit: 30, windowMs: 60 * 60 * 1000 },
  // A bootstrap proof should create about once; retries need headroom.
  create: { limit: 10, windowMs: 60 * 60 * 1000 },
  // Burst-friendly for quantity taps, bounded per principal.
  commands: { limit: 240, windowMs: 60 * 1000 },
  snapshot: { limit: 240, windowMs: 60 * 1000 },
};

type WindowCounter = { count: number; resetTime: number };

const memoryCounters = new Map<string, WindowCounter>();

function hashSubject(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function quotaKey(input: CartQuotaInput): string {
  return `baci:cart-quota:${input.operation}:${input.merchantId}:${hashSubject(input.subject)}`;
}

function parseCounter(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function incrementMemoryCounter(key: string, windowMs: number): WindowCounter {
  const now = Date.now();
  const existing = memoryCounters.get(key);
  const next =
    existing && now <= existing.resetTime
      ? { count: existing.count + 1, resetTime: existing.resetTime }
      : { count: 1, resetTime: now + windowMs };
  memoryCounters.set(key, next);
  return next;
}

async function incrementWindowCounter(
  key: string,
  windowMs: number
): Promise<WindowCounter> {
  const redis = getRedis();
  if (redis) {
    try {
      const script = redis.createScript<number | string>(`
        local count = redis.call("INCR", KEYS[1])
        if count == 1 then
          redis.call("PEXPIRE", KEYS[1], ARGV[1])
        end
        return count
      `);
      const count = parseCounter(
        await script.eval([key], [String(Math.max(1, windowMs))])
      );
      return { count, resetTime: Date.now() + windowMs };
    } catch {
      // Fall through to per-instance memory, mirroring the storefront
      // auth abuse store: Redis is the durable shared budget.
    }
  }
  return incrementMemoryCounter(key, windowMs);
}

/**
 * Tenant/principal-scoped cart quotas reusing the Redis window-counter
 * primitive. Complements the proxy per-IP rate limit with budgets that
 * survive carrier-NAT sharing and bind anonymous creation to one
 * merchant and client.
 */
export async function checkCartQuota(
  input: CartQuotaInput
): Promise<CartQuotaResult> {
  const budget = CART_QUOTA_BUDGETS[input.operation];
  const counter = await incrementWindowCounter(
    quotaKey(input),
    budget.windowMs
  );
  return {
    allowed: counter.count <= budget.limit,
    limit: budget.limit,
    remaining: Math.max(0, budget.limit - counter.count),
    resetTime: counter.resetTime,
  };
}

export function __resetCartQuotaStoreForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCartQuotaStoreForTesting should only run in tests');
  }
  memoryCounters.clear();
}
