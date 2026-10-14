'use client';

import { fetchJsonWithDeadline } from '@baci/shared/lib';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { forgetPendingVtuByReference } from './utility-pending-idempotency';
import {
  backfillPollDelayMs,
  INITIAL_UTILITY_VOUCHER_BACKFILL,
  isTerminalBackfill,
  parseUtilityVoucherBackfill,
  sleep,
  TAB_TO_HISTORY_TYPE,
  TOKEN_BACKFILL_HISTORY_TYPES,
  type UtilityVoucherBackfill,
  UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS,
  UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS,
} from './utility-voucher-backfill-model';

// Polls history until the voucher persists so the success view
// surfaces it without a replay (which the stale guard would suppress
// as "Already Completed"). Pure model (tabs, pacing, parsing,
// terminality) lives in utility-voucher-backfill-model.ts.
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
  const [backfill, setBackfill] = useState<UtilityVoucherBackfill>(
    INITIAL_UTILITY_VOUCHER_BACKFILL
  );

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
          // One deadline for headers + body; stalls abort the fetch
          // pre-retry (R70 6ryArL, R72 6rzq3y).
          const deadlineMs =
            Date.now() + UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS;
          const { data, response } = await fetchJsonWithDeadline(
            `/api/vtu/history?${params.toString()}`,
            {
              // Compatible composition (R66 floor); error bodies are
              // never read.
              signal: controller.signal,
              deadlineMs,
              shouldReadBody: (res) => res.ok,
            }
          );
          if (!response.ok) {
            // 5xx/429 are transient: consume the attempt and retry.
            // Other 4xx (auth, bad request) won't heal by retrying.
            if (response.status !== 429 && response.status < 500) {
              return;
            }
          } else {
            parsed = parseUtilityVoucherBackfill(data, reference);
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
          // Publish only observations attributable to the still-
          // signed-in submitter on a still-mounted view. A history
          // body resolving after an account switch belongs to the
          // previous customer: publishing it would render their
          // voucher PIN to the new account and fire onSettled (which
          // forgets the submitter's key despite the guarded direct
          // forget below), so a switch-back would mint fresh and
          // debit twice (Codex R85 P1). Withdraw anything published
          // for the previous account and keep polling unpublished —
          // the entry stays, so switch-back replays (R68 6rwg83).
          // Surface every attributed observation (e.g. failed with a
          // pending refund) while polling continues. Settlement is
          // decoupled from the pin hunt: terminality forgets the
          // retained entry on first observation (the success is
          // shown, so a repeat must mint fresh), while the loop may
          // keep hunting a late token.
          const currentUserId = await readUserId();
          if (
            !cancelled &&
            submitterUserId !== null &&
            submitterUserId === currentUserId
          ) {
            setBackfill(parsed);
            if (
              parsed.successful ||
              (parsed.failed && parsed.refundConfirmed)
            ) {
              forgetPendingVtuByReference(reference);
            }
            if (isTerminalBackfill(parsed, tokenExpected)) {
              return;
            }
          } else if (!cancelled) {
            setBackfill({ ...INITIAL_UTILITY_VOUCHER_BACKFILL });
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
