import { bootstrapNativeCart } from './bootstrap-native-cart';
import { NativeCartError } from './native-cart-error';
import { readOwnedCartProof } from './owned-session';
import { flushRetiredCartDevice } from './retire-device';
import { readNativeCartContext } from './session-context';
import type { CartSessionStorage } from './session-storage';
import type {
  CartFetch,
  NativeCartConfig,
  NativeCartReply,
} from './shared-cart-client';

export interface NativeCartSessionDeps {
  assertCurrent(indeterminate?: boolean): void;
  config: NativeCartConfig;
  fetcher: CartFetch;
  keepProof(reply: NativeCartReply, indeterminate?: boolean): Promise<void>;
  merchant: string;
  origin: string;
  read(
    route: string,
    method: 'GET',
    body: undefined,
    expectedCartId?: string
  ): Promise<NativeCartReply>;
  storage: CartSessionStorage;
}

/** Device session lifecycle: context, reads, bootstrap and recovery. */
export function createNativeCartSession(deps: NativeCartSessionDeps) {
  const { config, merchant, storage } = deps;
  return {
    async context(): Promise<{ actor: string; cartId: string | null } | null> {
      deps.assertCurrent();
      const proof = await readOwnedCartProof(
        storage,
        merchant,
        config.ownerSubject
      );
      deps.assertCurrent();
      if (!proof) return null;
      try {
        return readNativeCartContext(proof, merchant);
      } catch {
        // Only a structurally valid, tenant-matching expired proof may be
        // retired locally. Malformed or foreign proofs still fail closed.
        try {
          readNativeCartContext(proof, merchant, 0);
        } catch {
          throw new NativeCartError('invalid_proof');
        }
        await storage.remove(merchant);
        deps.assertCurrent();
        return null;
      }
    },
    async read(expectedCartId?: string): Promise<NativeCartReply> {
      const result = await deps.read('', 'GET', undefined, expectedCartId);
      if (!result.cart) throw new NativeCartError('temporarily_unavailable');
      return result;
    },
    async retireDevice(): Promise<void> {
      if (
        !storage.retire ||
        !storage.getRetiredProof ||
        !storage.acknowledgeRetirement
      )
        throw new NativeCartError('storage_unavailable');
      await storage.retire(merchant);
      await flushRetiredCartDevice(
        { ...config, merchantId: merchant },
        storage,
        deps.fetcher
      );
    },
    bootstrap: async () => {
      await flushRetiredCartDevice(
        { ...config, merchantId: merchant },
        storage,
        deps.fetcher
      );
      deps.assertCurrent();
      return bootstrapNativeCart(
        { ...config, merchantId: merchant, apiOrigin: deps.origin },
        storage,
        deps.fetcher,
        () => deps.assertCurrent(),
        (reply) => deps.keepProof(reply, false)
      );
    },
    async restartSession(): Promise<NativeCartReply> {
      // A completed/expired generation keeps its finished proof only until
      // the shopper explicitly starts shopping again; then a fresh
      // bootstrap principal replaces it. No server cart is mutated here.
      // Flush any pending device retirement before discarding the record.
      await flushRetiredCartDevice(
        { ...config, merchantId: merchant },
        storage,
        deps.fetcher
      );
      deps.assertCurrent();
      await storage.remove(merchant);
      deps.assertCurrent();
      return bootstrapNativeCart(
        { ...config, merchantId: merchant, apiOrigin: deps.origin },
        storage,
        deps.fetcher,
        () => deps.assertCurrent(),
        (reply) => deps.keepProof(reply, false)
      );
    },
    async recoverCreation(
      operationId: string
    ): Promise<NativeCartReply | null> {
      deps.assertCurrent();
      const receipt = await storage.getPromotionReceipt?.(merchant);
      deps.assertCurrent();
      if (receipt?.kind !== 'create' || receipt.operationId !== operationId)
        return null;
      const proof = await readOwnedCartProof(
        storage,
        merchant,
        config.ownerSubject
      );
      deps.assertCurrent();
      if (
        !proof ||
        readNativeCartContext(proof, merchant).cartId !== receipt.cartId
      )
        throw new NativeCartError('session_changed');
      return deps.read('', 'GET', undefined, receipt.cartId);
    },
    async recoverHandoff(attemptId: string): Promise<NativeCartReply | null> {
      deps.assertCurrent();
      const receipt = await storage.getPromotionReceipt?.(merchant);
      deps.assertCurrent();
      if (receipt?.kind !== 'handoff' || receipt.operationId !== attemptId)
        return null;
      const proof = await readOwnedCartProof(
        storage,
        merchant,
        config.ownerSubject
      );
      deps.assertCurrent();
      if (
        !proof ||
        readNativeCartContext(proof, merchant).cartId !== receipt.cartId
      )
        throw new NativeCartError('session_changed');
      return deps.read('', 'GET', undefined, receipt.cartId);
    },
  };
}
