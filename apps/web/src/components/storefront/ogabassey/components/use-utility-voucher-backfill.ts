'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { forgetPendingVtuByReference } from './utility-pending-idempotency';

// Bill-style purchases may receive their voucher after the initial
// 202, once the provider reports back. Poll history until the pin
// persists so the success view surfaces it without a replay (which
// the stale guard would suppress as "Already Completed").
// Airtime/data ride the same loop for settlement tracking: without
// it a telco 202 would sit on "Processing" forever. Mirrors
// mobile's useVtuVoucherPinBackfill (plain loop; same intervals).
export const UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS = 3000;
export const UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS = 10_000;
export const UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS = 60_000;
export const UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS = 10;
export const UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS = 43;
export const UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS = 73;
export const UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS = 10_000; // One hung read must not stall later attempts.

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
   * No refund outstanding. Fail-closed (explicit false only): a
   * missing flag keeps polling rather than claiming without proof.
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
 * confirmations), then 10s to attempt 43 (~6 minutes — covers a
 * single reconciliation pass), then a 60s patient lane to attempt
 * 73 (~36 minutes total). The reconciler rotates one 25-row page
 * per 5-minute window, so a row on a later page of a backlog
 * settles AFTER a 6-minute loop gives up — and since the stale
 * guard only fires past an OBSERVED completion, the retained entry
 * would then replay the old vend as a later identical purchase
 * (Codex R55 6rrU6M). The patient lane keeps watching through ~7
 * page rotations; each observation still settles the entry the
 * moment terminality lands.
 */
function backfillPollDelayMs(attempt: number): number {
  if (attempt <= UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS) {
    return UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS;
  }
  if (attempt <= UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS) {
    return UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS;
  }
  return UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS;
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
      // Reference scope: the target row is returned even when 20+
      // newer rows of the type would otherwise push it out (gtRR).
      reference,
    });
    (async () => {
      // Mobile parity: capture the polling account so a mid-flight
      // switch cannot forget the submitter's retained key for a
      // result never shown to them (Muse R57). Local session read,
      // no network; a failure degrades to null, which never forgets.
      const supabase = createClient();
      const readUserId = async (): Promise<string | null> => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          return session?.user?.id ?? null;
        } catch {
          return null;
        }
      };
      const submitterUserId = await readUserId();
      for (
        let attempt = 1;
        attempt <= UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        let parsed: UtilityVoucherBackfill | null = null;
        try {
          const response = await fetch(
            `/api/vtu/history?${params.toString()}`,
            {
              // Per-request bound: a hung read must not stall later attempts.
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS),
              ]),
            }
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
          // from the pin hunt: terminality forgets the retained entry
          // on first observation (the success is shown, so a repeat
          // must mint fresh), while the loop may keep hunting a
          // late token.
          setBackfill(parsed);
          if (
            parsed.successful ||
            (parsed.failed && parsed.refundConfirmed)
          ) {
            // Forget only for the still-signed-in submitter: after an
            // account switch the entry must stay, so a switch-back
            // identical purchase replays instead of minting fresh and
            // debiting a second time. (Unmount is already covered by
            // the cancelled check above.)
            const currentUserId = await readUserId();
            if (
              submitterUserId !== null &&
              submitterUserId === currentUserId
            ) {
              forgetPendingVtuByReference(reference);
            }
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
