import { z } from 'zod';
import {
  GuestCartCanonicalError,
  GuestCartExpiredError,
  GuestCartMigratedError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';

const replySchema = z.object({
  ok: z.boolean(),
  code: z.string().nullable().optional(),
  continueUrl: z.string().url().nullable().optional(),
  state: z
    .object({
      cartId: z.string().uuid(),
      version: z.number().int().positive(),
      expiresAt: z.string(),
      lines: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(10),
          })
        )
        .max(20),
    })
    .nullable(),
});
const brokerErrorSchema = z.object({
  code: z.string().max(64),
  cart_id: z.string().uuid().nullable().optional(),
  migrated_cart_id: z.string().uuid().nullable().optional(),
});
export interface GuestCanonicalBridge {
  update(
    token: string,
    input: {
      product_id: string;
      quantity: number;
      expectedVersion?: number;
      operationId?: string;
    }
  ): Promise<{
    cart_token: string;
    items: { product_id: string; quantity: number }[];
    expires_at: string;
    cart_url?: string;
    canonical_cart_id?: string;
    version?: number;
  }>;
  read?(token: string): Promise<Awaited<ReturnType<GuestCanonicalBridge['update']>>>;
  hasToken(token: string): Promise<boolean>;
}
/** Explicit configuration only; never send a capability to an inferred API host. */
/**
 * Exact origins the canonical bridge may target. The production
 * merchant origin is the default; operators running a staging or
 * additional deployment allowlist their exact origin through
 * MCP_CANONICAL_CART_BRIDGE_ALLOWED_ORIGINS (comma-separated) instead
 * of the bridge silently accepting arbitrary configured hosts.
 */
export function canonicalBridgeAllowedOrigins(
  configured = process.env.MCP_CANONICAL_CART_BRIDGE_ALLOWED_ORIGINS
): string[] {
  if (!configured?.trim()) return ['https://ogabassey.com'];
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Fail-soft bridge construction for the legacy store: a misconfigured
 * canonical endpoint must not brick legacy guest carts, so log the
 * bounded startup error and serve legacy only.
 */
export function createGuestCanonicalBridgeOrDisabled(): GuestCanonicalBridge | null {
  try {
    return createGuestCanonicalBridge();
  } catch {
    console.error(
      '[guest-cart] canonical bridge configuration invalid or origin not allowlisted; canonical carts disabled, serving legacy only'
    );
    return null;
  }
}

/** Capability scheme prefix shared by mutations and liveness probes. */
function capabilityAuthorization(token: string): string {
  return `Bearer ${['legacy', 'mcp', ''].join('_')}${token}`;
}

export function createGuestCanonicalBridge(
  configured = process.env.MCP_CANONICAL_CART_BRIDGE_URL,
  fetcher: typeof fetch = fetch,
  allowedOrigins: string[] = canonicalBridgeAllowedOrigins()
): GuestCanonicalBridge | null {
  if (!configured) return null;
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    !allowedOrigins.includes(url.origin) ||
    url.pathname !== '/api/storefront/cart/legacy' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('Invalid canonical cart bridge configuration');
  async function send(token: string, input: Record<string, unknown>) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid guest cart');
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: capabilityAuthorization(token),
      },
      body: JSON.stringify(input),
    }).catch(() => {
      throw new GuestCartCanonicalError('temporarily_unavailable', token);
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = replySchema.safeParse(body);
    if (response.ok && parsed.success && parsed.data.ok && parsed.data.state)
      return parsed.data;
    const failure = brokerErrorSchema.safeParse(body);
    const code = failure.success ? failure.data.code : null;
    const state = parsed.success ? parsed.data.state : null;
    const cartId =
      state?.cartId ??
      (failure.success ? (failure.data.cart_id ?? null) : null);
    if (code === 'cart_migrated')
      throw new GuestCartMigratedError(
        cartId ?? (failure.success ? failure.data.migrated_cart_id : null)
      );
    if (code === 'expired' || code === 'not_found')
      throw new GuestCartExpiredError();
    if (code === 'unauthorized' || code === 'forbidden')
      throw new GuestCartCanonicalError('unauthorized', token);
    const knownFailure = (
      [
        'version_conflict',
        'refresh_required',
        'temporarily_unavailable',
        'invalid_request',
        'invalid_item',
        'merchant_unavailable',
        'merchant_unresolved',
        'quota_exceeded',
        'rate_limited',
        'cart_locked',
        'idempotency_conflict',
        'merge_conflict',
        'handoff_consumed',
      ] as const
    ).find((candidate) => candidate === code);
    if (knownFailure)
      throw new GuestCartCanonicalError(
        knownFailure,
        token,
        cartId,
        state?.version ?? null
      );
    if (response.status === 429)
      throw new GuestCartCanonicalError('quota_exceeded', token);
    if (response.status >= 500)
      throw new GuestCartCanonicalError('temporarily_unavailable', token);
    throw new GuestCartStorageUnavailableError(
      'Canonical cart reply was invalid',
      'invalid_bridge_reply'
    );
  }
  function cartReply(token: string, reply: z.infer<typeof replySchema>) {
    if (!reply.state) throw new Error('Canonical cart unavailable');
    return { cart_token: token, items: reply.state.lines.map((x) => ({ product_id: x.productId, quantity: x.quantity })),
      expires_at: reply.state.expiresAt, cart_url: reply.continueUrl ?? undefined,
      canonical_cart_id: reply.state.cartId, version: reply.state.version };
  }
  return {
    async read(token) { return cartReply(token, await send(token, { handoff: true })); },
    async update(token, input) {
      const reply = await send(token, {
        productId: input.product_id,
        quantity: input.quantity,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
        handoff: true,
      });
      return cartReply(token, reply);
    },
    async hasToken(token) {
      // Read-only probe: the legacy route resolves the owner context
      // without migrating or mutating, so probing never consumes the
      // one-time migration or races a first real update.
      try {
        if (!/^[a-f0-9]{64}$/.test(token)) return false;
        const response = await fetcher(url, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: capabilityAuthorization(token),
          },
          body: JSON.stringify({ probe: true }),
        });
        if (!response.ok) return false;
        const body: unknown = await response.json().catch(() => null);
        return (
          typeof body === 'object' &&
          body !== null &&
          'exists' in body &&
          body.exists === true
        );
      } catch {
        return false;
      }
    },
  };
}
