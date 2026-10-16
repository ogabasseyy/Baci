'use client';

import { useEffect, useRef } from 'react';
import type { RefundSummary } from '@/lib/orders/refund-summary';

// Loads the refund status on mount and re-polls every 30s until the
// refund reaches a terminal state: terminal summaries never change
// without a new submission, which reloads inline, so polling past
// them only loads a payments-adjacent RPC.
export function useRefundStatusPolling({
  hasInitialSummary,
  onError,
  onSummary,
  orderId,
  revision,
  terminal,
}: {
  hasInitialSummary: boolean;
  onError: (message: string | null) => void;
  onSummary: (summary: RefundSummary) => void;
  orderId: string;
  revision: { current: number };
  terminal: boolean;
}) {
  const loadedOrder = useRef<string | null>(null);
  const requestSequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      const startedRevision = revision.current;
      // Monotonic per-request sequence: a slow poll overlapping the
      // next interval shares the submission revision, so without this
      // the older response would land last and clobber the panel with
      // stale balances, status, and action flags.
      const startedSequence = ++requestSequence.current;
      try {
        const response = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/refund`,
          {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'include',
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(data.error || 'Unable to load refund');
        if (
          active &&
          startedRevision === revision.current &&
          startedSequence === requestSequence.current
        ) {
          onSummary(data);
          onError(null);
        }
      } catch (e) {
        if (
          active &&
          startedRevision === revision.current &&
          startedSequence === requestSequence.current &&
          !controller.signal.aborted
        )
          onError(e instanceof Error ? e.message : 'Unable to load refund');
      }
    }
    // Load on mount and navigation only: terminal flips re-arm the
    // timer below, and refetching there would clobber the summary a
    // submit just installed with a stale read. With a server summary
    // the first paint is already valid, so the mount load is skipped
    // (the 30s poll still refreshes); only navigation past it loads.
    if (loadedOrder.current !== orderId) {
      const firstMount = loadedOrder.current === null;
      loadedOrder.current = orderId;
      if (!(firstMount && hasInitialSummary)) {
        void load();
      }
    }
    if (terminal) {
      return () => {
        active = false;
        controller.abort();
      };
    }
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
    // The setters are stable: this reloads on route and terminal
    // transitions only (hasInitialSummary is mount-only).
  }, [hasInitialSummary, onError, onSummary, orderId, revision, terminal]);
}
