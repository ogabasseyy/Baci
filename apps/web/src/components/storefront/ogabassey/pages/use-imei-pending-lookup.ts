'use client';

import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useEffect, useState } from 'react';
import { pollImeiCheck } from './imei-checker-request';
import type { ImeiResult } from './imei-checker-types';
import {
  clearPendingImeiLookup,
  getPendingImeiStorage,
  loadPendingImeiLookup,
  type PendingImeiLookup,
  pendingImeiStorageKey,
  savePendingImeiLookup,
} from './imei-pending-storage';

const MAX_ACTIVE_POLL_MS = 5 * 60 * 1000;
const PAUSED_POLL_MS = 60 * 1000;

interface ActivePendingImeiLookup extends PendingImeiLookup {
  canResume: boolean;
  pollAfterMs: number;
  scopeKey: string;
}

type PendingTerminal = (
  | {
      kind: 'complete';
      lookupId: string;
      result: ImeiResult;
      tier: ImeiServiceTierKey;
      device?: ImeiDeviceCategory;
      recovery?: PendingImeiLookup['recovery'];
    }
  | { error: string; kind: 'error'; tier: ImeiServiceTierKey }
) & { scopeKey: string | null };

export function useImeiPendingLookup({
  customerId,
  userId,
  host,
  merchantSlug,
}: {
  customerId?: string;
  userId?: string;
  host?: string;
  merchantSlug?: string;
}) {
  const resolvedHost =
    host ?? (typeof window === 'undefined' ? '' : window.location.host);
  const scopeKey = merchantSlug
    ? `${resolvedHost.toLowerCase()}:${merchantSlug.toLowerCase()}:${customerId ?? 'anonymous'}:${userId ?? ''}`
    : null;
  const storageKey =
    customerId && resolvedHost && merchantSlug
      ? pendingImeiStorageKey(resolvedHost, customerId, merchantSlug)
      : null;
  const [pending, setPending] = useState<ActivePendingImeiLookup | null>(null);
  const [paused, setPaused] = useState(false);
  const [terminal, setTerminal] = useState<PendingTerminal | null>(null);

  useEffect(() => {
    setPaused(false);
    setTerminal(null);
    if (!storageKey) {
      setPending(null);
      return;
    }
    const saved = loadPendingImeiLookup(getPendingImeiStorage(), storageKey);
    setPending(
      saved && scopeKey
        ? { ...saved, canResume: true, pollAfterMs: 0, scopeKey }
        : null
    );
  }, [scopeKey, storageKey]);

  useEffect(() => {
    if (!pending || !merchantSlug || pending.scopeKey !== scopeKey) return;

    const isStale =
      Date.now() - Date.parse(pending.createdAt) >= MAX_ACTIVE_POLL_MS;
    if (isStale) {
      setPaused(true);
    }

    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const outcome = await pollImeiCheck(pending.lookupId, merchantSlug);
        if (cancelled) return;

        if (outcome.kind === 'pending' || outcome.kind === 'retry') {
          setPending((current) =>
            current ? { ...current, pollAfterMs: outcome.pollAfterMs } : current
          );
          return;
        }

        if (storageKey)
          clearPendingImeiLookup(getPendingImeiStorage(), storageKey);
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
            : { error: outcome.error, kind: 'error', tier: pending.tier }),
        });
      },
      isStale ? PAUSED_POLL_MS : pending.pollAfterMs
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [merchantSlug, pending, scopeKey, storageKey]);

  return {
    clear() {
      if (storageKey)
        clearPendingImeiLookup(getPendingImeiStorage(), storageKey);
      setPending(null);
      setPaused(false);
    },
    clearTerminal() {
      setTerminal(null);
    },
    paused,
    canResume: pending?.canResume ?? false,
    pending,
    start({
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
      if (!scopeKey || !merchantSlug) return;
      const next = {
        createdAt: new Date().toISOString(),
        lookupId,
        pollAfterMs,
        scopeKey,
        tier,
        device,
        recovery,
      };
      const canResume = storageKey
        ? savePendingImeiLookup(getPendingImeiStorage(), storageKey, {
            createdAt: next.createdAt,
            lookupId,
            tier,
            device,
            recovery,
          })
        : false;
      setTerminal(null);
      setPaused(false);
      setPending({ ...next, canResume });
    },
    terminal: terminal?.scopeKey === scopeKey ? terminal : null,
  };
}
