'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeCustomerIdentityChange } from '@/contexts/customer-live-identity';
import { subscribeCustomerIdentityInvalidation } from '@/contexts/customer-identity-invalidation';
import { createClient } from '@/lib/supabase/client';
import {
  chatCancellationRevision,
  chatCancellationState,
  finishChatCancellation,
  reconcileChatCancellations,
  startChatCancellation,
  subscribeChatCancellations,
} from './chat-cancellation-state';

/** A synchronous generation prevents responses crossing an auth transition. */
export function useChatAccountScope(merchantSlug: string) {
  useSyncExternalStore(
    subscribeChatCancellations,
    chatCancellationRevision,
    () => 0
  );
  const generation = useRef(0);
  const cancellationPending = useRef(false);
  const cancellationOrderId = useRef<string | null>(null);
  const uncertainOrderId = useRef<string | null>(null);
  const isMounted = useRef(false);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<'starting' | 'ready' | 'unavailable'>(
    'starting'
  );
  const [cancellationUncertain, setCancellationUncertain] = useState(false);
  const [cancellationBusy, setCancellationBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    isMounted.current = true;
    const advance = () => {
      generation.current += 1;
      if (mounted) {
        if (cancellationPending.current) {
          uncertainOrderId.current = cancellationOrderId.current;
          setCancellationUncertain(true);
        }
        setRevision(generation.current);
      }
    };
    const unsubscribeIdentity = subscribeCustomerIdentityChange(advance);
    const crossTab = subscribeCustomerIdentityInvalidation(advance);
    let unsubscribeAuth = () => {};
    try {
      const { data } = createClient().auth.onAuthStateChange((event) => {
        if (event !== 'INITIAL_SESSION' && event !== 'TOKEN_REFRESHED')
          advance();
      });
      unsubscribeAuth = () => data.subscription.unsubscribe();
      setStatus(crossTab.available ? 'ready' : 'unavailable');
    } catch {
      setStatus('unavailable');
    }
    return () => {
      mounted = false;
      isMounted.current = false;
      generation.current += 1;
      unsubscribeIdentity();
      crossTab.unsubscribe();
      unsubscribeAuth();
    };
  }, [merchantSlug]);

  return {
    status,
    revision,
    capture: () => generation.current,
    isCurrent: (token: number) => generation.current === token,
    cancellationUncertain,
    cancellationBusy,
    startCancellation: (orderId: string) => {
      if (
        cancellationPending.current ||
        uncertainOrderId.current ||
        !startChatCancellation(merchantSlug, orderId)
      )
        return false;
      cancellationPending.current = true;
      cancellationOrderId.current = orderId;
      setCancellationBusy(true);
      setCancellationUncertain(false);
      return true;
    },
    finishCancellation: (token: number, confirmed: boolean) => {
      cancellationPending.current = false;
      if (!confirmed || generation.current !== token) {
        uncertainOrderId.current = cancellationOrderId.current;
        if (isMounted.current) setCancellationUncertain(true);
      }
      if (cancellationOrderId.current)
        finishChatCancellation(
          merchantSlug,
          cancellationOrderId.current,
          confirmed && generation.current === token
        );
      cancellationOrderId.current = null;
      if (isMounted.current) setCancellationBusy(false);
    },
    resolveCancellationWarning: (
      orders: ReadonlyArray<{ id: string; shipping_status: string | null }>
    ) => {
      reconcileChatCancellations(merchantSlug, orders);
      if (
        !cancellationPending.current &&
        uncertainOrderId.current &&
        orders.some(
          (order) =>
            order.id === uncertainOrderId.current &&
            order.shipping_status === 'cancelled'
        )
      ) {
        uncertainOrderId.current = null;
        setCancellationUncertain(false);
      }
      const blocked = orders.find((order) => {
        const state = chatCancellationState(merchantSlug, order.id);
        return state === 'pending' || state === 'uncertain';
      });
      if (blocked) {
        uncertainOrderId.current = blocked.id;
        setCancellationUncertain(true);
      }
    },
    isCancellationBlocked: (orderId: string) =>
      !!chatCancellationState(merchantSlug, orderId),
    isCancellationResolved: (orderId: string) =>
      chatCancellationState(merchantSlug, orderId) === 'resolved',
  };
}
