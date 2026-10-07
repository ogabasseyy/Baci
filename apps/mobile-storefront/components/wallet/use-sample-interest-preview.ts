import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { hostedStorefrontRuntime } from '@/lib/hosted-storefront-runtime';
import { createSampleInterestPreview } from '@/schemas/sample-interest-preview';

export function useSampleInterestPreview(
  ownerId: string | undefined,
  goal: Pick<
    WalletActiveSavingsGoal,
    'current_amount' | 'status' | 'title'
  > | null
) {
  const [openOwnerId, setOpenOwnerId] = useState<string | null>(null);
  const previousOwnerId = useRef(ownerId);
  const development = typeof __DEV__ !== 'undefined' && __DEV__;
  const environmentEnabled = development
    ? (() => {
        try {
          return hostedStorefrontRuntime.read() !== null;
        } catch {
          return false;
        }
      })()
    : false;
  const preview = createSampleInterestPreview(goal);

  useEffect(() => {
    if (previousOwnerId.current !== ownerId) {
      previousOwnerId.current = ownerId;
      setOpenOwnerId(null);
    }
  }, [ownerId]);

  return {
    available: Boolean(ownerId && preview && environmentEnabled),
    close: () => setOpenOwnerId(null),
    environmentEnabled,
    open: () => {
      if (ownerId && preview && environmentEnabled) setOpenOwnerId(ownerId);
    },
    preview,
    visible: Boolean(
      ownerId && preview && environmentEnabled && openOwnerId === ownerId
    ),
  };
}
