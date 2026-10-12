'use client';

import { useEffect, useState } from 'react';
import { settlePendingVtuByReference } from './utility-pending-idempotency';

// Bill-style purchases (power, TV, betting) may receive their voucher /
// token after the initial 202 returns, once the provider reports back.
// Poll the history endpoint until the pin is persisted so the success
// view can surface it without forcing a replay (which the stale guard
// would suppress as "Purchase Already Completed"). Airtime/data ride
// the same loop for settlement tracking (no voucher expected): without
// it a telco 202 would sit on "Processing" forever, never settle the
// retained key or refetch the wallet. Mirrors mobile's
// useVtuVoucherPinBackfill; web has no TanStack Query, so this uses a
// plain effect loop with the same interval and attempt cap.
export const UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS = 3000;
export const UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS = 10_000;
export const UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS = 10;
export const UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS = 43;

const TAB_TO_HISTORY_TYPE: Record<string, string> = {
  airtime: 'airtime',
  data: 'data',
  power: 'electricity',
  tv: 'cable_tv',
  betting: 'betting',
};

/** History types whose success may still gain a late token. */
const TOKEN_BACKFILL_HISTORY_TYPES: ReadonlySet<string> = new Set([
  'electricity',
  'cable_tv',
  'betting',
]);

export function isUtilityBackfillTab(tab: string): boolean {
  return TAB_TO_HISTORY_TYPE[tab] !== undefined;
}

export function isTokenBackfillTab(tab: string): boolean {
  const historyType = TAB_TO_HISTORY_TYPE[tab];
  return (
    historyType !== undefined && TOKEN_BACKFILL_HISTORY_TYPES.has(historyType)
  );
}

export interface UtilityVoucherBackfill {
  /** Failed observed; terminal only once refundConfirmed. */
  failed: boolean;
  /** Backfilled voucher/token; null until the provider reports it. */
  pin: string | null;
  /**
   * No refund outstanding: either never debited or the refund RPC
   * landed. Fail-closed (explicit false only): a missing flag keeps
   * polling rather than claiming a refund without proof.
   */
  refundConfirmed: boolean;
  /** Amount credited back, when known. */
  refundedAmount: number | null;
  /** Successful observed — even when no voucher is expected. */
  successful: boolean;
}

interface HistoryTransactionRow {
  refund_pending?: unknown;
  refunded_to_wallet?: unknown;
  request_reference?: unknown;
  status?: unknown;
  voucher_pin?: unknown;
}

/**
 * Extracts the backfill outcome for one reference. Returns null on a
 * schema mismatch (the caller halts: polling a broken contract burns
 * attempts returning nothing). A missing row, a pin-less non-terminal
 * row, or a failed row with a pending refund keeps polling.
 */
export function parseUtilityVoucherBackfill(
  body: unknown,
  reference: string
): UtilityVoucherBackfill | null {
  const transactions = (body as { transactions?: unknown } | null)
    ?.transactions;
  if (!Array.isArray(transactions)) {
    return null;
  }
  const match = transactions.find(
    (row) =>
      (row as HistoryTransactionRow | null)?.request_reference === reference
  ) as HistoryTransactionRow | undefined;
  if (!match) {
    return {
      failed: false,
      pin: null,
      refundConfirmed: false,
      refundedAmount: null,
      successful: false,
    };
  }
  const pin =
    typeof match.voucher_pin === 'string' ? match.voucher_pin.trim() : '';
  const refundedAmount =
    typeof match.refunded_to_wallet === 'number'
      ? match.refunded_to_wallet
      : null;
  return {
    failed: match.status === 'failed',
    pin: pin || null,
    refundConfirmed: match.refund_pending === false,
    refundedAmount,
    successful: match.status === 'successful',
  };
}

/**
 * Terminal backfill: show it and stop polling. A pin always stops the
 * hunt. A successful row keeps polling while a token may still arrive
 * (the server schedules late token backfills for pin-less successes
 * of these types); tokenless successes and confirmed failures settle.
 */
function isTerminalBackfill(
  backfill: UtilityVoucherBackfill,
  tokenExpected: boolean
): boolean {
  if (backfill.pin !== null) {
    return true;
  }
  if (backfill.successful) {
    return !tokenExpected;
  }
  return backfill.failed && backfill.refundConfirmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff schedule: 3s for the first 10 attempts (fast provider
 * confirmations), then 10s. 43 attempts span ~6 minutes — enough to
 * cover a full reconciliation pass (45s cron age gate + 5-minute
 * voucher schedule) instead of giving up after 27s.
 */
function backfillPollDelayMs(attempt: number): number {
  return attempt <= UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS
    ? UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS
    : UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS;
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
    refundConfirmed: false,
    refundedAmount: null,
    successful: false,
  });

  useEffect(() => {
    const historyType = TAB_TO_HISTORY_TYPE[utilityTab];
    if (!enabled || !reference || !merchantSlug || !historyType) {
      return;
    }
    const tokenExpected = TOKEN_BACKFILL_HISTORY_TYPES.has(historyType);
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
        let parsed: UtilityVoucherBackfill | null = null;
        try {
          const response = await fetch(
            `/api/vtu/history?${params.toString()}`,
            { signal: controller.signal }
          );
          if (!response.ok) {
            // 5xx/429 are transient: consume the attempt and retry.
            // Other 4xx (auth, bad request) won't heal by retrying.
            if (response.status !== 429 && response.status < 500) {
              return;
            }
          } else {
            parsed = parseUtilityVoucherBackfill(
              await response.json(),
              reference
            );
            // Broken contract: halt instead of burning attempts.
            if (parsed === null) {
              return;
            }
          }
        } catch {
          // Network/timeout failure: transient, retry within budget.
          // Abort (unmount) lands here too — the cancelled check below
          // stops the loop without another fetch.
          if (controller.signal.aborted) {
            return;
          }
        }
        if (cancelled || controller.signal.aborted) {
          return;
        }
        if (parsed) {
          // Surface every observation (e.g. failed with a pending
          // refund) while polling continues. Settlement is decoupled
          // from the pin hunt: success marks completion (and
          // confirmed failure forgets) on first observation, while
          // the loop may keep hunting a late token.
          setBackfill(parsed);
          if (
            parsed.successful ||
            (parsed.failed && parsed.refundConfirmed)
          ) {
            settlePendingVtuByReference(
              reference,
              parsed.failed ? 'failed' : 'successful'
            );
          }
          if (isTerminalBackfill(parsed, tokenExpected)) {
            return;
          }
        }
        if (attempt < UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS) {
          await sleep(backfillPollDelayMs(attempt));
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
