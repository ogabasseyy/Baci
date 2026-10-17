import { buildPendingVtuScopeTag } from '@baci/shared';
import { useEffect } from 'react';
import { fetchVoucherPin } from '@/hooks/use-vtu-voucher-pin-backfill-fetch';
import { CONFIG } from '@/lib/config';
import { listNotedPendingVtuReferences } from '@/lib/pending-vtu-idempotency';
import { resolveIdempotencyScopeOwnerId } from '@/lib/utility-owner-ids';
import { useAuthStore } from '@/stores/auth-store';

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
 * Mobile mirror of web's useUtilityRetainedSettlement (Codex R57
 * 6rsvy7): the voucher backfill stops polling after ~36 minutes and
 * history screens show capped newest-first pages, so a row settling
 * later — then pushed out of the page — would leave its entry
 * replaying the old vend as a new purchase. When the purchase
 * screen opens, every retained noted reference gets a direct
 * reference-scoped history read; successes mark stale (suppressed
 * completions skipped, R68), refunded failures forget.
 *
 * Zero-cost when idle: with no retained references no fetch runs.
 * Fail-open: history errors leave entries untouched (the replay
 * path still dedupes). Switch-safe: userId is an effect dep, so an
 * account switch cancels the in-flight pass (and fetchVoucherPin
 * re-verifies the polling account itself).
 */
export function useVtuRetainedSettlement({
  enabled,
}: {
  enabled: boolean;
}): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const ownerId = useAuthStore((state) =>
    resolveIdempotencyScopeOwnerId(state.user?.id, state.customer?.id)
  );

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }
    // Owner-scoped (Codex R62 6rtokd): same pair the idempotency
    // scope hashed. Foreign references would only burn history
    // reads under the wrong session; untagged legacy still settle.
    const references = listNotedPendingVtuReferences(
      buildPendingVtuScopeTag(ownerId, CONFIG.MERCHANT_ID)
    );
    if (references.length === 0) {
      return;
    }
    let cancelled = false;
    const submitterUserId = userId;
    // fetchVoucherPin's reads already time out (SHORT_TIMEOUT), so
    // this pass always settles — a gated submit cannot hang on it.
    const pass = (async () => {
      await Promise.all(
        references.map(async (reference) => {
          try {
            // apiType null: no type filter — the reference alone
            // scopes the read, whatever its utility type.
            await fetchVoucherPin({
              apiType: null,
              // Bulk pass, nothing shown: successes mark stale (R68).
              backgroundSettle: true,
              capturedUserId: submitterUserId,
              isViewActive: () => !cancelled,
              reference,
            });
          } catch {
            // Fail-open (see docblock).
          }
        })
      );
    })();
    activeSettlementPass = pass;
    void pass.finally(() => {
      if (activeSettlementPass === pass) {
        activeSettlementPass = null;
      }
    });
    return () => {
      cancelled = true;
      // Detach (Codex R67 6rwGM5): without this, an account switch
      // leaves the new owner's submits awaiting the previous
      // account's pass until its timeout — their effect installs no
      // replacement when they have no retained references. The
      // orphaned pass still runs out (fetchVoucherPin re-verifies
      // the polling account, so it forgets nothing foreign).
      if (activeSettlementPass === pass) {
        activeSettlementPass = null;
      }
    };
  }, [enabled, ownerId, userId]);
}
