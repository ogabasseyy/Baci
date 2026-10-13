'use client';

import { buildPendingVtuScopeTag } from '@baci/shared';
import { fetchWithTimeout, withDeadline } from '@baci/shared/lib';
import { useEffect } from 'react';
import {
  forgetPendingVtuByReference,
  listNotedPendingVtuReferences,
  markSettledPendingVtuByReference,
} from './utility-pending-idempotency';
import { parseUtilityVoucherBackfill } from './use-utility-voucher-backfill';

/**
 * In-flight settlement pass, if any. Submit paths branch on
 * {@link getPendingVtuSettlementPass} before recall-or-mint so a
 * submit racing the pass cannot reuse a key the pass is about to
 * forget (Codex R60 6rs7PV). Branch-on-null (not an unconditional
 * await) keeps the common no-pass submit synchronously dispatched.
 */
let activeSettlementPass: Promise<void> | null = null;

export function getPendingVtuSettlementPass(): Promise<void> | null {
  return activeSettlementPass;
}

/**
 * Background terminal update for retained idempotency entries.
 *
 * The voucher backfill stops polling after ~36 minutes, but
 * reconciliation pages are unbounded — a row settling later would
 * leave its entry replaying the old vend as a new purchase (Codex
 * R57 6rseWu). Web has no history screen to observe through, so the
 * purchase modal settles on open instead: for every retained noted
 * reference, a reference-scoped history read settles terminal rows
 * before the customer can repeat — successes mark stale (skipping
 * suppressed completions, R68), refunded failures forget.
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
  scopeMerchantId,
  scopeOwnerId,
  userId,
}: {
  enabled: boolean;
  merchantSlug: string | null | undefined;
  scopeMerchantId: string | null | undefined;
  scopeOwnerId: string | null | undefined;
  userId: string | null | undefined;
}): void {
  useEffect(() => {
    if (!enabled || !merchantSlug || !userId) {
      return;
    }
    // Owner-scoped (Codex R62 6rtokd): the registry survives
    // switches by design, so filter to the active account's tag —
    // foreign references would only burn history reads (and gate
    // latency) under the wrong session. Untagged legacy entries
    // still settle (fail open).
    const references = listNotedPendingVtuReferences(
      buildPendingVtuScopeTag(scopeOwnerId, scopeMerchantId)
    );
    if (references.length === 0) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const pass = (async () => {
      const outcomes = await Promise.all(
        references.map(async (reference) => {
          try {
            const params = new URLSearchParams({
              merchantSlug,
              limit: '1',
              reference,
            });
            // One deadline for headers + body (Codex R70 6ryArL):
            // bounded so a hung history endpoint cannot stall a gated
            // submit past the fail-open timeout.
            const deadlineMs = Date.now() + 10_000;
            const response = await fetchWithTimeout(
              `/api/vtu/history?${params.toString()}`,
              {
                // Compatible composition (Codex R66 6rvh_R): no
                // AbortSignal.any/.timeout (missing below the safari
                // 15.4 floor).
                signal: controller.signal,
                deadlineMs,
              }
            );
            if (!response.ok) {
              return null;
            }
            const body = await withDeadline(response.json(), deadlineMs);
            return {
              reference,
              backfill: parseUtilityVoucherBackfill(body, reference),
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
        if (!parsed) {
          continue;
        }
        // Success settles via mark-stale (suppressed completions are
        // skipped so their replay presents — R68 6rwG9F). Refunded
        // failure forgets: nothing was delivered, so the retry is
        // correctly a fresh charge attempt.
        if (parsed.successful) {
          markSettledPendingVtuByReference(outcome.reference);
        } else if (parsed.failed && parsed.refundConfirmed) {
          forgetPendingVtuByReference(outcome.reference);
        }
      }
    })();
    activeSettlementPass = pass;
    void pass.finally(() => {
      if (activeSettlementPass === pass) {
        activeSettlementPass = null;
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, merchantSlug, scopeMerchantId, scopeOwnerId, userId]);
}
