import { BANK_CARD_OFFER_REFERENCE_PATTERN } from '@baci/shared/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/lib/logger';
import { useCartStore } from '@/stores/cart-store';

const CONSUMED_MARKER = 'consumed';
const SNAPSHOT_PREFIX = 'bank-offer-checkout-cart:';
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const pendingCartOperations = new Map<string, Promise<void>>();

async function runCartStep<T>(
  operation: 'save' | 'cleanup' | 'expire',
  stage:
    | 'list_snapshots'
    | 'read_snapshot'
    | 'write_snapshot'
    | 'clear_cart'
    | 'mark_consumed',
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.warn('Bank card checkout', 'Cart snapshot operation failed', {
      operation,
      stage,
    });
    void import('@/services/analytics')
      .then(({ trackError }) =>
        trackError(
          'bank_offer_cart_storage',
          'Cart snapshot operation failed',
          {
            operation,
            stage,
          }
        )
      )
      .catch(() => undefined);
    throw error;
  }
}

async function serializeCartOperation(
  key: string,
  operation: () => Promise<void>
) {
  const previous = pendingCartOperations.get(key);
  const current = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation);
  pendingCartOperations.set(key, current);
  try {
    await current;
  } finally {
    if (pendingCartOperations.get(key) === current)
      pendingCartOperations.delete(key);
  }
}

function cartIdentity() {
  if (!useCartStore.persist?.hasHydrated()) return null;
  const { checkoutGeneration, items, sharedCartRef } = useCartStore.getState();
  if (!checkoutGeneration || !items.length) return null;
  return JSON.stringify([
    checkoutGeneration,
    sharedCartRef?.merchantId,
    sharedCartRef?.cartId,
    items.map((item) => [
      item.id,
      item.product_id,
      item.variant_id,
      item.offer_id,
      item.quantity,
      item.price,
      item.negotiatedPrice,
      item.hasAssurance,
    ]),
  ]);
}

function storageKey(orderId: string, reference: string) {
  if (!BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)) return null;
  return `${SNAPSHOT_PREFIX}${orderId}:${reference}`;
}

function readSnapshot(value: string) {
  const separator = value.indexOf('\n');
  if (separator === -1) return { identity: value, expiresAt: undefined };
  return {
    identity: value.slice(separator + 1),
    expiresAt: Number(value.slice(0, separator)),
  };
}

async function expireAbandonedSnapshots(currentKey: string, now: number) {
  const keys = await runCartStep('expire', 'list_snapshots', () =>
    AsyncStorage.getAllKeys()
  );
  const snapshotKeys = keys.filter(
    (key) => key !== currentKey && key.startsWith(SNAPSHOT_PREFIX)
  );
  if (snapshotKeys.length === 0) return;
  const snapshots = await runCartStep('expire', 'read_snapshot', () =>
    AsyncStorage.getMany(snapshotKeys)
  );
  for (const [key, value] of Object.entries(snapshots)) {
    if (!value || value === CONSUMED_MARKER) continue;
    const { expiresAt } = readSnapshot(value);
    // Older snapshots have no timestamp. A fresh checkout can retire them.
    if (expiresAt !== undefined && expiresAt > now) continue;
    await serializeCartOperation(key, async () => {
      const current = await runCartStep('expire', 'read_snapshot', () =>
        AsyncStorage.getItem(key)
      );
      if (current !== value) return;
      await runCartStep('expire', 'mark_consumed', () =>
        AsyncStorage.setItem(key, CONSUMED_MARKER)
      );
    });
  }
}

export const deferredBankOfferCart = {
  capture: cartIdentity,
  async remember(orderId: string, reference: string, identity: string) {
    const key = storageKey(orderId, reference);
    if (!key) return;
    const now = Date.now();
    let saved = false;
    await serializeCartOperation(key, async () => {
      const existing = await runCartStep('save', 'read_snapshot', () =>
        AsyncStorage.getItem(key)
      );
      if (!existing) {
        await runCartStep('save', 'write_snapshot', () =>
          AsyncStorage.setItem(key, `${now + SNAPSHOT_MAX_AGE_MS}\n${identity}`)
        );
        saved = true;
      }
    });
    // A storage housekeeping failure cannot prevent checkout.
    if (saved) await expireAbandonedSnapshots(key, now).catch(() => undefined);
  },
  // Call only after server verification confirms this exact order and
  // reference are paid. With no matching snapshot, leave the cart intact.
  async clearIfUnchanged(
    orderId: string,
    reference: string,
    isActive: () => boolean
  ) {
    const key = storageKey(orderId, reference);
    if (!key) return;
    await serializeCartOperation(key, async () => {
      const expected = await runCartStep('cleanup', 'read_snapshot', () =>
        AsyncStorage.getItem(key)
      );
      if (!isActive() || expected === CONSUMED_MARKER) return;
      const snapshot = expected ? readSnapshot(expected) : null;
      if (
        snapshot &&
        (snapshot.expiresAt === undefined || snapshot.expiresAt > Date.now())
      ) {
        if (!useCartStore.persist?.hasHydrated()) return;
        if (cartIdentity() === snapshot.identity) {
          await runCartStep('cleanup', 'clear_cart', () =>
            useCartStore.getState().clearCart()
          );
        } else {
          logger.info(
            'Bank card checkout',
            'Preserved an edited cart after payment'
          );
        }
      }
      // Payment is verified. Even if the snapshot was absent or the cart
      // was edited, a repeat callback must not bind this order to a new cart.
      await runCartStep('cleanup', 'mark_consumed', () =>
        AsyncStorage.setItem(key, CONSUMED_MARKER)
      );
    });
  },
};
