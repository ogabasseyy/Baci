'use client';

import { useEffect } from 'react';
import {
  forgetPendingVtuByReference,
  listNotedPendingVtuReferences,
} from './utility-pending-idempotency';
import { parseUtilityVoucherBackfill } from './use-utility-voucher-backfill';

/**
 * Background terminal update for retained idempotency entries.
 *
 * The voucher backfill stops polling after ~36 minutes, but
 * reconciliation pages are unbounded — a row settling later would
 * leave its entry replaying the old vend as a new purchase (Codex
 * R57 6rseWu). Web has no history screen to observe through, so the
 * purchase modal settles on open instead: for every retained noted
 * reference, a reference-scoped history read forgets terminally
 * settled entries (success, or failed with a confirmed refund —
 * the same rule as the backfill) before the customer can repeat.
 *
 * Zero-cost when idle: with no retained references no fetch runs.
 * Fail-open: history errors, schema mismatches, and non-terminal
 * rows leave entries untouched (the replay path still dedupes).
 * Switch-safe: userId is an effect dep, so an account switch
 * cancels the in-flight pass instead of forgetting for a result
 * the submitter never saw.
 */
export function useUtilityRetainedSettlement({
  enabled,
  merchantSlug,
  userId,
}: {
  enabled: boolean;
  merchantSlug: string | null | undefined;
  userId: string | null | undefined;
}): void {
  useEffect(() => {
    if (!enabled || !merchantSlug || !userId) {
      return;
    }
    const references = listNotedPendingVtuReferences();
    if (references.length === 0) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      const outcomes = await Promise.all(
        references.map(async (reference) => {
          try {
            const params = new URLSearchParams({
              merchantSlug,
              limit: '1',
              reference,
            });
            const response = await fetch(
              `/api/vtu/history?${params.toString()}`,
              { signal: controller.signal }
            );
            if (!response.ok) {
              return null;
            }
            return {
              reference,
              backfill: parseUtilityVoucherBackfill(
                await response.json(),
                reference
              ),
            };
          } catch {
            return null;
          }
        })
      );
      if (cancelled || controller.signal.aborted) {
        return;
      }
      for (const outcome of outcomes) {
        const parsed = outcome?.backfill;
        if (
          parsed &&
          (parsed.successful || (parsed.failed && parsed.refundConfirmed))
        ) {
          forgetPendingVtuByReference(outcome.reference);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, merchantSlug, userId]);
}
