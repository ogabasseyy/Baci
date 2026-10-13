import { useEffect } from 'react';
import { fetchVoucherPin } from '@/hooks/use-vtu-voucher-pin-backfill-fetch';
import { listNotedPendingVtuReferences } from '@/lib/pending-vtu-idempotency';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Background terminal update for retained idempotency entries.
 *
 * Mobile mirror of web's useUtilityRetainedSettlement (Codex R57
 * 6rsvy7): the voucher backfill stops polling after ~36 minutes and
 * history screens show capped newest-first pages, so a row settling
 * later — then pushed out of the page — would leave its entry
 * replaying the old vend as a new purchase. When the purchase
 * screen opens, every retained noted reference gets a direct
 * reference-scoped history read; fetchVoucherPin forgets terminally
 * settled entries (success, or failed with a confirmed refund).
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

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }
    const references = listNotedPendingVtuReferences();
    if (references.length === 0) {
      return;
    }
    let cancelled = false;
    const submitterUserId = userId;
    void Promise.all(
      references.map(async (reference) => {
        try {
          // apiType null: no type filter — the reference alone
          // scopes the read, whatever its utility type.
          await fetchVoucherPin({
            apiType: null,
            capturedUserId: submitterUserId,
            isViewActive: () => !cancelled,
            reference,
          });
        } catch {
          // Fail-open (see docblock).
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);
}
