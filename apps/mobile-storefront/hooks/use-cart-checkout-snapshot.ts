import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';

export type CartCheckoutReviewStatus =
  | 'idle'
  | 'reviewing'
  | 'ready'
  | 'stale'
  | 'error';

/** Preparation reviews one exact tenant, session and revision; it never submits an order. */
export function useCartCheckoutSnapshot() {
  const enabled = useNativeSharedCartStore((state) => state.enabled);
  const snapshot = useNativeSharedCartStore((state) => state.snapshot);
  const owner = useNativeSharedCartStore((state) => state.accountUserId);
  const prepare = useNativeSharedCartStore(
    (state) => state.prepareCheckoutReview
  );
  const refresh = useNativeSharedCartStore((state) => state.refresh);
  const [review, setReview] = useState<NativeCheckoutSnapshot | null>(null);
  const reviewScope = useRef<string | null>(null);
  const [status, setStatus] = useState<CartCheckoutReviewStatus>('idle');
  const [retryCount, setRetryCount] = useState(0);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const cartId = snapshot?.cartId;
  const merchantId = snapshot?.merchantId;
  const version = snapshot?.version;
  const key = JSON.stringify([enabled, owner, merchantId, cartId, version]);
  const latest = useRef(key);
  latest.current = `${key}:${retryCount}`;

  useEffect(() => {
    let active = true;
    const current = () => {
      const live = useNativeSharedCartStore.getState();
      return (
        active &&
        latest.current === `${key}:${retryCount}` &&
        live.enabled === enabled &&
        live.accountUserId === owner &&
        live.snapshot?.merchantId === merchantId &&
        live.snapshot?.cartId === cartId &&
        live.snapshot?.version === version &&
        live.prepareCheckoutReview === prepare
      );
    };
    setReview(null);
    useNativeSharedCartStore.setState({ checkoutReview: null });
    if (!enabled || !cartId || !merchantId || !version || !prepare) {
      setStatus('idle');
      return () => {
        active = false;
      };
    }
    if (operation.current?.key !== key)
      operation.current = { key, id: Crypto.randomUUID() };
    const operationId = operation.current.id;
    setStatus('reviewing');
    void (async () => {
      try {
        const result = await prepare(operationId);
        if (!current()) return;
        if (
          result.snapshot.cartId !== cartId ||
          result.snapshot.merchantId !== merchantId ||
          result.snapshot.cartVersion !== version
        )
          throw new NativeCartError('refresh_required');
        reviewScope.current = `${key}:${retryCount}`;
        operation.current = null;
        setReview(result.snapshot);
        useNativeSharedCartStore.setState({ checkoutReview: result.snapshot });
        setStatus('ready');
      } catch (error) {
        if (!current()) return;
        const code = error instanceof NativeCartError ? error.code : '';
        if (code === 'refresh_required' || code === 'version_conflict') {
          operation.current = null;
          setStatus('stale');
          await refresh?.().catch(() => undefined);
        } else setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [
    enabled,
    owner,
    merchantId,
    cartId,
    version,
    prepare,
    refresh,
    key,
    retryCount,
  ]);

  const stale =
    reviewScope.current !== `${key}:${retryCount}` ||
    !enabled ||
    !review ||
    !snapshot ||
    review.merchantId !== snapshot.merchantId ||
    review.cartId !== snapshot.cartId ||
    review.cartVersion !== snapshot.version;
  const binding: CartCheckoutBinding | null =
    review && !stale
      ? {
          cart_id: review.cartId,
          checkout_session_id: review.checkoutSessionId,
          checkout_generation: review.generation,
          cart_version: review.cartVersion,
        }
      : null;
  return {
    binding,
    review,
    stale: enabled ? stale : false,
    status,
    retry: async () => setRetryCount((count) => count + 1),
    availableLines: review?.lines.filter((line) => line.available) ?? [],
  };
}
