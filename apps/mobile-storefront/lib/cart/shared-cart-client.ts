import type {
  CartInputLine,
  CartMergeResolution,
  CartMutationInput,
  CartSnapshot,
} from '@baci/shared/cart';
import { validateCartCommand } from '@baci/shared/cart';
import { fetch as expoFetch } from 'expo/fetch';
import { nativeCartReplySchema } from '@/schemas/cart';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { previewNativeHandoff } from './handoff-preview';
import { createNativeAccountCheckout } from './native-account-checkout';
import { NativeCartError } from './native-cart-error';
import { readOwnedCartProof } from './owned-session';
import { type CartSessionStorage, cartSessionStorage } from './session-storage';
import { createNativeCartSession } from './shared-cart-session';

export interface NativeCartConfig {
  merchantId: string;
  merchantSlug: string;
  apiOrigin: string;
  ownerSubject?: string;
}
export interface NativeCartReply {
  cart?: CartSnapshot | null;
  proof?: string;
  replayed?: boolean;
  warnings?: { code: string; message: string; lineId?: string }[];
  snapshot?: NativeCheckoutSnapshot;
  sessionReused?: boolean;
  linkedUserId?: string;
}
export { NativeCartError } from './native-cart-error';
export interface NativeAccountLinkInput {
  operationId: string;
  choice: 'keep_current' | 'use_saved' | 'merge';
  expectedSavedCartId?: string | null;
  expectedSavedVersion?: number;
  expectedCurrentVersion?: number;
  lines?: CartInputLine[];
  resolutions?: CartMergeResolution[];
}
export type CartFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Route = '' | '/commands' | '/handoff/redeem' | '/checkout' | '/account';
const proofPattern = /^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const operationId = (value: string) =>
  value.trim().length > 0 && value.length <= 128;

/** Dedicated guest-cart transport; never reads or replaces shopper Auth tokens. */
export function createNativeCartClient(
  config: NativeCartConfig,
  storage: CartSessionStorage = cartSessionStorage,
  fetcher: CartFetch = expoFetch,
  isCurrent: () => boolean = () => true,
  getShopperToken: () => Promise<string | null> = async () => null
) {
  const base = new URL(config.apiOrigin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !config.merchantSlug ||
    !/^[0-9a-f-]{36}$/i.test(config.merchantId)
  )
    throw new NativeCartError('invalid_configuration');
  function assertCurrent(indeterminate = false): void {
    if (!isCurrent())
      throw new NativeCartError('session_changed', indeterminate);
  }
  const origin = base.origin;
  const merchant = config.merchantId.toLowerCase();
  function url(route: string): string {
    return `${origin}/api/storefront/cart${route}?merchantSlug=${encodeURIComponent(config.merchantSlug)}`;
  }
  async function send(
    route: Route,
    method: 'GET' | 'POST',
    body?: unknown,
    expectedCartId?: string
  ): Promise<NativeCartReply> {
    assertCurrent();
    const proof = await readOwnedCartProof(
      storage,
      merchant,
      config.ownerSubject
    );
    assertCurrent();
    if (!proof || !proofPattern.test(proof) || proof.length > 8192)
      throw new NativeCartError('missing_proof');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetcher(url(route), {
        method,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${proof}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json();
      assertCurrent(method === 'POST');
      const parsed = nativeCartReplySchema.safeParse(value);
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.error ||
        parsed.data.code
      ) {
        const code =
          parsed.success &&
          parsed.data.code &&
          /^[a-z_]{1,64}$/.test(parsed.data.code)
            ? parsed.data.code
            : 'temporarily_unavailable';
        throw new NativeCartError(
          code,
          method === 'POST' && (response.status >= 500 || !parsed.success)
        );
      }
      const reply = parsed.data;
      if (
        reply.cart &&
        (reply.cart.merchantId.toLowerCase() !== merchant ||
          (expectedCartId &&
            reply.cart.cartId.toLowerCase() !== expectedCartId.toLowerCase()))
      )
        throw new NativeCartError('merchant_mismatch', method === 'POST');
      return reply;
    } catch (error) {
      if (error instanceof NativeCartError) throw error;
      throw new NativeCartError('temporarily_unavailable', method === 'POST');
    } finally {
      clearTimeout(timer);
    }
  }
  async function keepProof(
    reply: NativeCartReply,
    indeterminate = true,
    promotion?: {
      operationId: string;
      cartId: string;
      kind: 'create' | 'handoff' | 'account';
      ownerSubject?: string;
      fromActor?: string;
    }
  ): Promise<void> {
    assertCurrent(indeterminate);
    if (!reply.proof) return;
    try {
      if (promotion) await storage.set(merchant, reply.proof, promotion);
      else await storage.set(merchant, reply.proof);
    } catch {
      throw new NativeCartError('storage_unavailable', indeterminate);
    }
  }
  const accountCheckout = createNativeAccountCheckout({
    merchant,
    url,
    storage,
    fetcher,
    assertCurrent,
    getShopperToken,
    getOwnerSubject: () => config.ownerSubject ?? null,
    readProof: () => readOwnedCartProof(storage, merchant, config.ownerSubject),
    readCart: (cartId) => send('', 'GET', undefined, cartId),
    keepProof,
    send: (route, method, body, expectedCartId) =>
      send(route, method, body, expectedCartId),
  });
  const session = createNativeCartSession({
    assertCurrent,
    config,
    fetcher,
    keepProof: (reply, indeterminate) => keepProof(reply, indeterminate),
    merchant,
    origin,
    read: (route, method, body, expectedCartId) =>
      send(route as Route, method, body, expectedCartId),
    storage,
  });
  return {
    config: { ...config, apiOrigin: origin },
    previewHandoff: (handoffId: string, token: string) =>
      previewNativeHandoff(
        { ...config, apiOrigin: origin },
        handoffId,
        token,
        fetcher
      ),
    ...session,
    async create(input: {
      operationId: string;
      lines?: CartInputLine[];
      currency?: string;
    }): Promise<NativeCartReply> {
      if (!operationId(input.operationId))
        throw new NativeCartError('invalid_request');
      const result = await send('', 'POST', input);
      if (!result.cart || !result.proof)
        throw new NativeCartError('temporarily_unavailable', true);
      await keepProof(result, true, {
        operationId: input.operationId,
        cartId: result.cart.cartId,
        kind: 'create',
      });
      return result;
    },
    async command(
      input: CartMutationInput,
      cartId: string
    ): Promise<NativeCartReply> {
      if (
        !operationId(input.operationId) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        validateCartCommand(input.command)
      )
        throw new NativeCartError('invalid_request');
      const result = await send('/commands', 'POST', input, cartId);
      if (!result.cart)
        throw new NativeCartError('temporarily_unavailable', true);
      await keepProof(result);
      return result;
    },
    async redeem(input: {
      token: string;
      handoffId: string;
      attemptId: string;
      choice: 'connect' | 'merge' | 'keep_existing';
      resolutions?: CartMergeResolution[];
      destCartId?: string;
      expectedIncomingVersion?: number;
      expectedDestVersion?: number;
      lines?: CartInputLine[];
    }): Promise<NativeCartReply> {
      const result = await send('/handoff/redeem', 'POST', input);
      if (!result.proof)
        throw new NativeCartError('temporarily_unavailable', true);
      if (!result.cart) {
        // keep_existing with no destination cart: the handoff is
        // consumed and the server answers with a fresh bootstrap proof.
        // Persist it so the session can continue; dropping it would
        // strand the shopper behind the now-consumed link.
        await keepProof(result);
        return result;
      }
      await keepProof(result, true, {
        operationId: input.attemptId,
        cartId: result.cart.cartId,
        kind: 'handoff',
      });
      return result;
    },
    ...accountCheckout,
  };
}
export type NativeCartClient = ReturnType<typeof createNativeCartClient>;
