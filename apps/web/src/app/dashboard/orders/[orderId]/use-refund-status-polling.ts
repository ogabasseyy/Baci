'use client';

import { useEffect, useRef } from 'react';
import type { RefundSummary } from '@/lib/orders/refund-summary';

// Loads the refund status on mount and re-polls every 30s until the
// refund reaches a terminal state: terminal summaries never change
// without a new submission, which reloads inline, so polling past
// them only loads a payments-adjacent RPC. Hidden tabs pause, and
// returning to the tab refreshes immediately instead of waiting
// out the interval on stale balances.
//
// A settled (refunded Paystack-backed) order keeps a slow bounded
// contradiction watch instead of the 30s poll: a later provider
// verdict can re-open the balance, but the server-side
// completed-refund sweep owns long-term detection, so one order
// view watches for an hour, then stops. Interval polls and tab
// returns share the twelve-load cap, so refocusing the tab cannot
// bill the RPC past the bound either.
const SETTLED_WATCH_INTERVAL_MS = 300_000;
const SETTLED_WATCH_MAX_POLLS = 12;
export function useRefundStatusPolling({
  hasInitialSummary,
  onError,
  onSummary,
  orderId,
  revision,
  settledWatch,
  terminal,
}: {
  hasInitialSummary: boolean;
  onError: (message: string | null) => void;
  onSummary: (summary: RefundSummary) => void;
  orderId: string;
  revision: { current: number };
  settledWatch: boolean;
  terminal: boolean;
}) {
  const loadedOrder = useRef<string | null>(null);
  // The order whose mount load already billed the RPC before the
  // summary settled: the settled watch carries that load into its
  // cap instead of restarting at zero on the transition.
  const billedOrder = useRef<string | null>(null);
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
    // Hidden ticks never consume the settled cap: only polls that
    // actually bill the RPC count toward the hour — the mount load
    // below included, or a no-initial-summary view would bill
    // thirteen loads under a twelve-load bound. When the summary
    // only settles after that mount load, the effect restarts with
    // settledWatch true, so the billed load carries in here.
    let settledPolls = billedOrder.current === orderId ? 1 : 0;
    // Load on mount and navigation only: terminal flips re-arm the
    // timer below, and refetching there would clobber the summary a
    // submit just installed with a stale read. With a server summary
    // the first paint is already valid, so the mount load is skipped
    // (the 30s poll still refreshes); only navigation past it loads.
    if (loadedOrder.current !== orderId) {
      const firstMount = loadedOrder.current === null;
      loadedOrder.current = orderId;
      if (!(firstMount && hasInitialSummary)) {
        billedOrder.current = orderId;
        if (settledWatch) {
          settledPolls += 1;
        }
        void load();
      }
    }
    if (terminal) {
      return () => {
        active = false;
        controller.abort();
      };
    }
    const timer = setInterval(
      () => {
        if (document.hidden) {
          return;
        }
        if (settledWatch) {
          settledPolls += 1;
          if (settledPolls > SETTLED_WATCH_MAX_POLLS) {
            clearInterval(timer);
            return;
          }
        }
        void load();
      },
      settledWatch ? SETTLED_WATCH_INTERVAL_MS : 30_000
    );
    const onVisibility = () => {
      if (!document.hidden) {
        // Tab returns bill the same RPC as interval polls, so the
        // settled watch counts them against its cap: past twelve
        // billed loads a refocus refreshes nothing.
        if (settledWatch) {
          if (settledPolls >= SETTLED_WATCH_MAX_POLLS) {
            return;
          }
          settledPolls += 1;
        }
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The setters are stable: this reloads on route, terminal,
    // and settled-watch transitions only (hasInitialSummary is
    // mount-only).
  }, [
    hasInitialSummary,
    onError,
    onSummary,
    orderId,
    revision,
    settledWatch,
    terminal,
  ]);
}
