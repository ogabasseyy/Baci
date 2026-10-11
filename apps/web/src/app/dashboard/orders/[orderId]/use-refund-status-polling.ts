'use client';

import { useEffect } from 'react';
import type { RefundSummary } from '@/lib/orders/refund-summary';

// Loads the refund status on mount and re-polls every 30s until the
// refund reaches a terminal state: terminal summaries never change
// without a new submission, which reloads inline, so polling past
// them only loads a payments-adjacent RPC.
export function useRefundStatusPolling({
  onError,
  onSummary,
  orderId,
  revision,
  terminal,
}: {
  onError: (message: string | null) => void;
  onSummary: (summary: RefundSummary) => void;
  orderId: string;
  revision: { current: number };
  terminal: boolean;
}) {
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      const startedRevision = revision.current;
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
        if (active && startedRevision === revision.current) {
          onSummary(data);
          onError(null);
        }
      } catch (e) {
        if (
          active &&
          startedRevision === revision.current &&
          !controller.signal.aborted
        )
          onError(e instanceof Error ? e.message : 'Unable to load refund');
      }
    }
    void load();
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
    // transitions only.
  }, [onError, onSummary, orderId, revision, terminal]);
}
