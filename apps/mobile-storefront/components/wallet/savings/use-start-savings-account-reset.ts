import { useRef } from 'react';

type NullSetter = (value: null) => void;
type FlagSetter = (value: boolean) => void;

/**
 * Resets server-bound savings state once when the signed-in user changes
 * without unmounting, so the next account never inherits the previous
 * account's created goal, idempotency keys, or modals. Draft inputs
 * (amounts, dates) are intentionally kept: they submit only under the
 * current session.
 */
export function useStartSavingsAccountReset(
  userId: string | undefined,
  setters: {
    setCreatedGoalId: NullSetter;
    setGoalIdempotencyKey: NullSetter;
    setInitialContributionIdempotencyKey: NullSetter;
    setFormError: NullSetter;
    setShowFundingModal: FlagSetter;
    setShowPreviewModal: FlagSetter;
    setShowSuccessModal: FlagSetter;
    setShowTransferModal: FlagSetter;
  }
): void {
  const userIdRef = useRef(userId);
  if (userIdRef.current !== userId) {
    userIdRef.current = userId;
    setters.setCreatedGoalId(null);
    setters.setGoalIdempotencyKey(null);
    setters.setInitialContributionIdempotencyKey(null);
    setters.setFormError(null);
    setters.setShowFundingModal(false);
    setters.setShowPreviewModal(false);
    setters.setShowSuccessModal(false);
    setters.setShowTransferModal(false);
  }
}
