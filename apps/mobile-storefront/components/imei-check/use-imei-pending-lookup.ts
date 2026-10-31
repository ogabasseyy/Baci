import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useEffect, useRef, useState } from 'react';
import {
  clearPendingImeiLookup,
  loadPendingImeiLookup,
  type PendingImeiLookup,
  pendingImeiStorageKey,
  savePendingImeiLookup,
} from '@/lib/imei-pending-storage';
import { pollImeiLookup } from '@/lib/imei-poll-client';
import type { ImeiResult } from '@/lib/validation';

const MAX_ACTIVE_POLL_MS = 5 * 60 * 1000;
const PAUSED_POLL_MS = 60 * 1000;

interface ActivePendingLookup extends PendingImeiLookup {
  pollAfterMs: number;
  scopeKey: string | null;
  canResume: boolean;
}

type PendingTerminal = (
  | {
      kind: 'complete';
      device?: ImeiDeviceCategory;
      lookupId: string;
      result: ImeiResult;
      tier: ImeiServiceTierKey;
      recovery?: PendingImeiLookup['recovery'];
    }
  | {
      confirmedRefund?: boolean;
      error: string;
      kind: 'error';
      recovery?: PendingImeiLookup['recovery'];
      tier: ImeiServiceTierKey;
    }
) & { scopeKey: string | null };

export function useImeiPendingLookup({
  accessToken,
  userId,
  apiBaseUrl,
  customerId,
  merchantId,
}: {
  accessToken?: string;
  userId?: string;
  apiBaseUrl: string;
  customerId?: string;
  merchantId?: string;
}) {
  const storageKey =
    merchantId && customerId
      ? pendingImeiStorageKey(merchantId, customerId)
      : null;
  const scopeKey = `${storageKey}:${userId ?? ''}`;
  const previousStorageKey = useRef<string | null>(null);
  const pendingMutation = useRef(0);
  const [pending, setPending] = useState<ActivePendingLookup | null>(null);
  const [paused, setPaused] = useState(false);
  const [terminal, setTerminal] = useState<PendingTerminal | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restoreGeneration = pendingMutation.current;
    const restore = async () => {
      const previous = previousStorageKey.current;
      if (previous && previous !== storageKey) {
        await clearPendingImeiLookup(previous);
      }
      previousStorageKey.current = storageKey;

      if (!storageKey) {
        if (
          previous &&
          !cancelled &&
          pendingMutation.current === restoreGeneration
        ) {
          setPending(null);
        }
        return;
      }
      const saved = await loadPendingImeiLookup(storageKey);
      if (!cancelled && pendingMutation.current === restoreGeneration) {
        if (saved) {
          setPending({
            ...saved,
            pollAfterMs: 0,
            scopeKey,
            canResume: true,
          });
        } else if (previous && previous !== storageKey) {
          setPending(null);
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [storageKey, scopeKey]);

  useEffect(() => {
    if (!pending || pending.scopeKey !== scopeKey) return;
    const isStale =
      Date.now() - Date.parse(pending.createdAt) >= MAX_ACTIVE_POLL_MS;
    if (isStale) {
      setPaused(true);
    }

    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const outcome = await pollImeiLookup({
          accessToken,
          apiBaseUrl,
          lookupId: pending.lookupId,
        });
        if (cancelled) return;

        if (outcome.kind === 'pending' || outcome.kind === 'retry') {
          setPending((current) =>
            current ? { ...current, pollAfterMs: outcome.pollAfterMs } : current
          );
          return;
        }

        if (storageKey) await clearPendingImeiLookup(storageKey);
        if (cancelled) return;
        setPending(null);
        setPaused(false);
        setTerminal({
          scopeKey,
          ...(outcome.kind === 'complete'
            ? {
                kind: 'complete',
                lookupId: pending.lookupId,
                result: outcome.result,
                tier: pending.tier,
                device: pending.device,
                recovery: pending.recovery,
              }
            : {
                error: outcome.error,
                kind: 'error',
                tier: pending.tier,
                recovery: pending.recovery,
                confirmedRefund: outcome.confirmedRefund,
              }),
        });
      },
      isStale ? PAUSED_POLL_MS : pending.pollAfterMs
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, apiBaseUrl, pending, storageKey, scopeKey]);

  const visiblePending = pending?.scopeKey === scopeKey ? pending : null;

  return {
    async clear() {
      pendingMutation.current += 1;
      if (storageKey) await clearPendingImeiLookup(storageKey);
      setPending(null);
      setPaused(false);
    },
    clearTerminal() {
      setTerminal(null);
    },
    paused,
    pending: visiblePending,
    canResume: visiblePending?.canResume ?? true,
    async start({
      lookupId,
      pollAfterMs,
      tier,
      device,
      recovery,
    }: {
      lookupId: string;
      pollAfterMs: number;
      tier: ImeiServiceTierKey;
      device?: ImeiDeviceCategory;
      recovery?: PendingImeiLookup['recovery'];
    }) {
      pendingMutation.current += 1;
      const next = {
        createdAt: new Date().toISOString(),
        lookupId,
        pollAfterMs,
        tier,
        device,
        recovery,
        scopeKey,
        canResume: false,
      };
      setTerminal(null);
      setPaused(false);
      setPending(next);
      const canResume = storageKey
        ? await savePendingImeiLookup(storageKey, next)
        : false;
      setPending((current) =>
        current?.lookupId === lookupId && current.scopeKey === scopeKey
          ? { ...current, canResume }
          : current
      );
    },
    terminal: terminal?.scopeKey === scopeKey ? terminal : null,
  };
}
