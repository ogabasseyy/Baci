import { useEffect, useRef, useState } from 'react';
import { WALLET_DISCOVERY } from '@/constants/wallet-discovery';
import { listSavingsGoals } from '@/lib/customer-savings';
import { asyncStorage } from '@/lib/storage';

export function useWalletDiscoveryHint({
  enabled,
  userId,
  merchantId,
}: {
  enabled: boolean;
  userId?: string;
  merchantId?: string;
}) {
  const scope = userId && merchantId ? `${merchantId}:${userId}` : '';
  const [visibleScope, setVisibleScope] = useState<string | null>(null);
  const markedScope = useRef<string | null>(null);

  useEffect(() => {
    setVisibleScope(null);
    if (!enabled || !scope || !merchantId) return;
    const controller = new AbortController();
    const key = `${WALLET_DISCOVERY.storagePrefix}${scope}`;
    const timer = setTimeout(() => {
      async function checkEligibility() {
        try {
          const seen = await asyncStorage.getItem(key);
          if (seen || controller.signal.aborted) return;
          const result = await listSavingsGoals({
            merchantId,
            signal: controller.signal,
          });
          if (controller.signal.aborted || result.goals.length > 0) return;
          setVisibleScope(scope);
        } catch {
          if (!controller.signal.aborted) setVisibleScope(null);
        }
      }
      void checkEligibility();
    }, WALLET_DISCOVERY.delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, merchantId, scope]);

  useEffect(() => {
    if (!enabled || !scope || visibleScope !== scope) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active || markedScope.current === scope) return;
      markedScope.current = scope;
      void asyncStorage.setItem(
        `${WALLET_DISCOVERY.storagePrefix}${scope}`,
        'seen'
      );
    }, WALLET_DISCOVERY.delayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, scope, visibleScope]);

  function dismiss() {
    if (visibleScope === scope && scope && markedScope.current !== scope) {
      markedScope.current = scope;
      void asyncStorage.setItem(
        `${WALLET_DISCOVERY.storagePrefix}${scope}`,
        'seen'
      );
    }
    setVisibleScope(null);
  }

  return {
    visible: enabled && !!scope && visibleScope === scope,
    dismiss,
  };
}
