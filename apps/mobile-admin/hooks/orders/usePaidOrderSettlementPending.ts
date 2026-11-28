import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type VerifiedSettlementAction,
  verifiedSettlementActionSchema,
} from '@/lib/paid-order-amendment-api';
import { asyncStorage } from '@/lib/storage';

export function usePaidOrderSettlementPending({
  operatorId,
  orderId,
  amendmentId,
}: {
  operatorId: string;
  orderId: string;
  amendmentId: string;
}) {
  const queryKey = [
    'verified-amendment-operation',
    operatorId,
    orderId,
    amendmentId,
  ];
  const storageKey = queryKey.join(':');
  const unreadableKey = `${storageKey}:unreadable`;
  const [unreadableMessage, setUnreadableMessage] = useState(false);
  const pending = useQuery({
    queryKey,
    queryFn: async () => {
      if ((await asyncStorage.getItem(unreadableKey)) === '1') {
        setUnreadableMessage(true);
        return { unreadable: true as const };
      }
      const saved = await asyncStorage.getItem(storageKey);
      if (!saved) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(saved);
      } catch {
        decoded = undefined;
      }
      const parsed = verifiedSettlementActionSchema.safeParse(decoded);
      if (parsed.success) return parsed.data;
      try {
        await asyncStorage.setItem(unreadableKey, '1');
      } catch {
        setUnreadableMessage(true);
        return { unreadable: true as const };
      }
      try {
        await asyncStorage.removeItem(storageKey);
      } catch {
        // The durable marker keeps the recovery action available to retry.
      }
      setUnreadableMessage(true);
      return { unreadable: true as const };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const isVerifiedAction = (
    value: typeof pending.data
  ): value is VerifiedSettlementAction =>
    Boolean(value && !('unreadable' in value));
  const savedAction = isVerifiedAction(pending.data) ? pending.data : null;
  const unreadableSavedAction =
    (pending.data !== undefined &&
      pending.data !== null &&
      !isVerifiedAction(pending.data)) ||
    unreadableMessage;

  return {
    pending,
    queryKey,
    storageKey,
    unreadableKey,
    unreadableMessage,
    setUnreadableMessage,
    savedAction,
    unreadableSavedAction,
  };
}
