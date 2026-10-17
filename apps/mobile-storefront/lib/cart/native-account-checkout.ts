import { nativeCartReplySchema } from '@/schemas/cart';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { NativeCartError } from './native-cart-error';
import { readNativeCartContext } from './session-context';
import type { CartSessionStorage } from './session-storage';
import type {
  CartFetch,
  NativeAccountLinkInput,
  NativeCartReply,
} from './shared-cart-client';

const proofPattern = /^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const operationId = (value: string) =>
  value.trim().length > 0 && value.length <= 128;

interface Deps {
  merchant: string;
  url(route: string): string;
  storage: CartSessionStorage;
  fetcher: CartFetch;
  assertCurrent(indeterminate?: boolean): void;
  getShopperToken(): Promise<string | null>;
  getOwnerSubject(): string | null;
  readProof(): Promise<string | null>;
  readCart(cartId: string): Promise<NativeCartReply>;
  keepProof(
    reply: NativeCartReply,
    indeterminate?: boolean,
    promotion?: {
      operationId: string;
      cartId: string;
      kind: 'create' | 'handoff' | 'account';
      ownerSubject?: string;
      fromActor?: string;
    }
  ): Promise<void>;
  send(
    route: '/checkout',
    method: 'POST',
    body: unknown,
    expectedCartId: string
  ): Promise<NativeCartReply>;
}

/**
 * Account-link and checkout-review transport. Shopper authority (the
 * Auth JWT) and cart authority (the session proof) travel in separate
 * headers and are never substituted for each other.
 */
export function createNativeAccountCheckout(deps: Deps) {
  const { merchant, storage, fetcher, assertCurrent } = deps;
  async function accountRequest(
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<NativeCartReply> {
    assertCurrent();
    const proof = await deps.readProof();
    assertCurrent();
    if (!proof || !proofPattern.test(proof) || proof.length > 8192)
      throw new NativeCartError('missing_proof');
    const token = await deps.getShopperToken();
    assertCurrent(method === 'POST');
    if (!token) throw new NativeCartError('unauthorized');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetcher(deps.url('/account'), {
        method,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Cart-Session-Proof': proof,
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
      if (reply.cart && reply.cart.merchantId.toLowerCase() !== merchant)
        throw new NativeCartError('merchant_mismatch', method === 'POST');
      return reply;
    } catch (error) {
      if (error instanceof NativeCartError) throw error;
      throw new NativeCartError('temporarily_unavailable', method === 'POST');
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    savedAccountCart(): Promise<NativeCartReply> {
      return accountRequest('GET');
    },
    async linkAccount(input: NativeAccountLinkInput): Promise<NativeCartReply> {
      if (!operationId(input.operationId))
        throw new NativeCartError('invalid_request');
      const ownerSubject = deps.getOwnerSubject();
      if (!ownerSubject) throw new NativeCartError('unauthorized');
      const originalProof = await deps.readProof();
      if (!originalProof) throw new NativeCartError('missing_proof');
      const fromActor = readNativeCartContext(originalProof, merchant).actor;
      const result = await accountRequest('POST', input);
      if (
        result.linkedUserId !== ownerSubject ||
        deps.getOwnerSubject() !== ownerSubject
      )
        throw new NativeCartError('session_changed', true);
      if (!result.cart || !result.proof || !result.linkedUserId)
        throw new NativeCartError('temporarily_unavailable', true);
      await deps.keepProof(result, true, {
        operationId: input.operationId,
        cartId: result.cart.cartId,
        kind: 'account',
        ownerSubject,
        fromActor,
      });
      return result;
    },
    async recoverAccountLink(
      operationIdValue: string,
      ownerSubject: string,
      fromActor: string
    ): Promise<NativeCartReply | null> {
      assertCurrent();
      if (deps.getOwnerSubject() !== ownerSubject)
        throw new NativeCartError('session_changed');
      const receipt = await storage.getPromotionReceipt?.(merchant);
      assertCurrent();
      if (
        receipt?.kind !== 'account' ||
        receipt.operationId !== operationIdValue ||
        receipt.ownerSubject !== ownerSubject ||
        receipt.fromActor !== fromActor
      )
        return null;
      const proof = await deps.readProof();
      assertCurrent();
      if (
        !proof ||
        readNativeCartContext(proof, merchant).cartId !== receipt.cartId
      )
        throw new NativeCartError('session_changed');
      const saved = await deps.readCart(receipt.cartId);
      if (!saved.cart || saved.cart.cartId !== receipt.cartId)
        throw new NativeCartError('session_changed');
      return saved;
    },
    async prepareCheckout(input: {
      cartId: string;
      expectedVersion: number;
      operationId: string;
    }): Promise<{
      snapshot: NativeCheckoutSnapshot;
      replayed: boolean;
      sessionReused: boolean;
    }> {
      if (
        !operationId(input.operationId) ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1
      )
        throw new NativeCartError('invalid_request');
      const result = await deps.send('/checkout', 'POST', input, input.cartId);
      if (
        !result.snapshot ||
        result.snapshot.cartId !== input.cartId ||
        result.snapshot.merchantId.toLowerCase() !== merchant
      )
        throw new NativeCartError('temporarily_unavailable', true);
      // Preparation can renew this device's grant to cover the new
      // checkout session; persist the returned proof or the bound order
      // becomes unusable once the older proof expires.
      if (result.proof) await deps.keepProof(result);
      return {
        snapshot: result.snapshot,
        replayed: result.replayed === true,
        sessionReused: result.sessionReused === true,
      };
    },
  };
}
