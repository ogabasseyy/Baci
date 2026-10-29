'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeCustomerIdentityInvalidation } from '@/contexts/customer-identity-invalidation';
import { subscribeCustomerIdentityChange } from '@/contexts/customer-live-identity';
import { createClient } from '@/lib/supabase/client';
import {
  type ChatCancellationOutcome,
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
        setCancellationUncertain(cancellationPending.current);
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
        !startChatCancellation(merchantSlug, orderId)
      )
        return false;
      cancellationPending.current = true;
      cancellationOrderId.current = orderId;
      setCancellationBusy(true);
      return true;
    },
    finishCancellation: (token: number, outcome: ChatCancellationOutcome) => {
      cancellationPending.current = false;
      const current = generation.current === token;
      const effectiveOutcome =
        outcome === 'not-applied' || current ? outcome : 'uncertain';
      if (effectiveOutcome === 'uncertain') {
        if (isMounted.current) setCancellationUncertain(true);
      } else if (outcome === 'not-applied' && !current) {
        if (isMounted.current) setCancellationUncertain(false);
      }
      if (cancellationOrderId.current)
        finishChatCancellation(
          merchantSlug,
          cancellationOrderId.current,
          effectiveOutcome
        );
      cancellationOrderId.current = null;
      if (isMounted.current) setCancellationBusy(false);
    },
    resolveCancellationWarning: (
      orders: ReadonlyArray<{ id: string; shipping_status: string | null }>
    ) => {
      reconcileChatCancellations(merchantSlug, orders);
      const blocked = orders.find((order) => {
        const state = chatCancellationState(merchantSlug, order.id);
        return state === 'pending' || state === 'uncertain';
      });
      setCancellationUncertain(Boolean(blocked));
    },
    isCancellationBlocked: (orderId: string) =>
      !!chatCancellationState(merchantSlug, orderId),
    isCancellationResolved: (orderId: string) =>
      chatCancellationState(merchantSlug, orderId) === 'resolved',
  };
}
