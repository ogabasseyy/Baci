'use client';

import { buildPendingVtuScopeTag } from '@baci/shared';
import { fetchWithTimeout } from '@baci/shared/lib';
import { useEffect } from 'react';
import {
  forgetPendingVtuByReference,
  listNotedPendingVtuReferences,
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
            const response = await fetchWithTimeout(
              `/api/vtu/history?${params.toString()}`,
              {
                // Bounded so a hung history endpoint cannot stall a
                // gated submit forever (fail-open on timeout, as on
                // any other read error). Compatible composition (Codex
                // R66 6rvh_R): no AbortSignal.any/.timeout (missing
                // below the safari 15.4 floor).
                signal: controller.signal,
                timeoutMs: 10_000,
              }
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
