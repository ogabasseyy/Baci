'use client';

import { useEffect, useState } from 'react';

// Bill-style purchases (power, TV, betting) may receive their voucher /
// token after the initial 202 returns, once the provider reports back.
// Poll the history endpoint until the pin is persisted so the success
// view can surface it without forcing a replay (which the stale guard
// would suppress as "Purchase Already Completed"). Mirrors mobile's
// useVtuVoucherPinBackfill; web has no TanStack Query, so this uses a
// plain effect loop with the same interval and attempt cap.
export const UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS = 3000;
export const UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS = 10;

const TAB_TO_HISTORY_TYPE: Record<string, string> = {
  power: 'electricity',
  tv: 'cable_tv',
  betting: 'betting',
};

export function isUtilityVoucherBackfillTab(tab: string): boolean {
  return TAB_TO_HISTORY_TYPE[tab] !== undefined;
}

export interface UtilityVoucherBackfill {
  /** The purchase terminally failed: render failure, not the spinner. */
  failed: boolean;
  /** Backfilled voucher/token; null until the provider reports it. */
  pin: string | null;
}

interface HistoryTransactionRow {
  request_reference?: unknown;
  status?: unknown;
  voucher_pin?: unknown;
}

/**
 * Extracts the backfill outcome for one reference. Returns null on a
 * schema mismatch (the caller halts: polling a broken contract burns
 * attempts returning nothing). A missing row or a pin-less
 * non-terminal row keeps polling (pin null, failed false).
 */
export function parseUtilityVoucherBackfill(
  body: unknown,
  reference: string
): UtilityVoucherBackfill | null {
  const transactions = (body as { transactions?: unknown } | null)?.transactions;
  if (!Array.isArray(transactions)) {
    return null;
  }
  const match = transactions.find(
    (row) =>
      (row as HistoryTransactionRow | null)?.request_reference === reference
  ) as HistoryTransactionRow | undefined;
  if (!match) {
    return { failed: false, pin: null };
  }
  const pin =
    typeof match.voucher_pin === 'string' ? match.voucher_pin.trim() : '';
  return {
    failed: match.status === 'failed',
    pin: pin || null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useUtilityVoucherBackfill({
  enabled,
  merchantSlug,
  reference,
  utilityTab,
}: {
  enabled: boolean;
  merchantSlug: string | null | undefined;
  reference: string;
  utilityTab: string;
}): UtilityVoucherBackfill {
  const [backfill, setBackfill] = useState<UtilityVoucherBackfill>({
    failed: false,
    pin: null,
  });

  useEffect(() => {
    const historyType = TAB_TO_HISTORY_TYPE[utilityTab];
    if (!enabled || !reference || !merchantSlug || !historyType) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({
      merchantSlug,
      limit: '20',
      type: historyType,
    });
    (async () => {
      for (
        let attempt = 1;
        attempt <= UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        let parsed: UtilityVoucherBackfill | null;
        try {
          const response = await fetch(`/api/vtu/history?${params.toString()}`, {
            signal: controller.signal,
          });
          // HTTP/network/schema failures halt polling: the purchase
          // outcome is unknown, so keep the static processing copy
          // instead of burning attempts or misreporting failure.
          if (!response.ok) {
            return;
          }
          parsed = parseUtilityVoucherBackfill(
            await response.json(),
            reference
          );
          if (parsed === null) {
            return;
          }
        } catch {
          return;
        }
        if (cancelled) {
          return;
        }
        if (parsed.pin || parsed.failed) {
          setBackfill(parsed);
          return;
        }
        if (attempt < UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS) {
          await sleep(UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, merchantSlug, reference, utilityTab]);

  return backfill;
}
