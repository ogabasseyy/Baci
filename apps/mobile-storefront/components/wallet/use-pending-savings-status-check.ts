import { useEffect, useRef, useState } from 'react';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import {
  checkPendingPrimarySavings,
  type PendingSavingsCheckOutcome,
} from './check-pending-primary-savings';
import { savingsNotifier } from './savings/savings-notice';
import type { ContributionRail } from './savings/stored-contribution-operation';
import {
  EARLIER_CONTRIBUTION_CHECKING_MESSAGE,
  planWalletSavingsRail,
} from './wallet-savings-rail';

/** A status read's outcome, or why none was sent. */
export type SavingsStatusCheckResult =
  | PendingSavingsCheckOutcome
  /** Another check for this operation is still running. */
  | 'busy'
  /** No stored operation (or this screen's own add is still sending it). */
  | 'no-operation'
  /** The operation's rail is no longer available: kept, not checked. */
  | 'blocked';

/**
 * Status reads for the stored pending contribution, and nothing else: it
 * never starts a transfer and never mints an operation id. It keeps its own
 * "checking" flag, so a status read never shows the "Adding your money…"
 * cover that belongs to a contribution being sent.
 */
export function usePendingSavingsStatusCheck(input: {
  goal: WalletActiveSavingsGoal | null;
  merchantId?: string;
  idempotencyKeyRef: { current: string | null };
  operationRailRef: { current: ContributionRail | null };
  submittingRef?: { current: boolean };
  refetchWallet: () => Promise<unknown>;
  setSavingsContributionAmount: (value: string) => void;
}) {
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  // One read at a time: a tap, the timer and a return to the app must not
  // race two reads on the same operation and notice.
  const inFlight = useRef(false);
  // The operation already told "Still checking": a blocked rail warns once,
  // not on every automatic tick.
  const blockedNoticeFor = useRef<string | null>(null);
  // A read still running when the wallet goes away drops its "still
  // waiting" news instead of posting it after the screen is gone.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // automatic: a timer or foreground read. It posts only settled outcomes, so
  // a dismissed "pending" or "unavailable" notice never reopens by itself.
  const checkStatus = async (
    options: { automatic?: boolean } = {}
  ): Promise<SavingsStatusCheckResult> => {
    const operationId = input.idempotencyKeyRef.current;
    if (!operationId) return 'no-operation';
    // This screen's own add is still sending it: try again on the next tick.
    if (input.submittingRef?.current) return 'busy';
    if (inFlight.current) return 'busy';
    const { merchantId } = input;
    const plan = planWalletSavingsRail({
      hasStoredId: true,
      isPrimary:
        isPiggyvestPrimaryMerchant(merchantId) &&
        readPiggyvestCapabilityNow(merchantId) !== false,
      storedRail: input.operationRailRef.current,
    });
    if (plan.kind === 'blocked') {
      if (blockedNoticeFor.current !== operationId) {
        blockedNoticeFor.current = operationId;
        savingsNotifier()(
          'Still checking',
          EARLIER_CONTRIBUTION_CHECKING_MESSAGE,
          'warning'
        );
      }
      return 'blocked';
    }
    // A legacy id has no status read: only its own add retries it.
    if (plan.kind !== 'check-primary') return 'no-operation';
    inFlight.current = true;
    // A late answer must not clear a newer operation that took over the
    // screen (another account, merchant or goal), nor its amount.
    const ours = () => input.idempotencyKeyRef.current === operationId;
    let released = false;
    try {
      return await checkPendingPrimarySavings({
        goal: input.goal,
        merchantId,
        operationId,
        clearOperation: () => {
          if (!ours()) return;
          released = true;
          input.idempotencyKeyRef.current = null;
          input.operationRailRef.current = null;
        },
        clearAmount: () => {
          if (released || ours()) input.setSavingsContributionAmount('');
        },
        refetchWallet: input.refetchWallet,
        setPending: setIsCheckingStatus,
        isLive: () => live.current && !options.automatic && ours(),
        // Still ours after this read settled it (released) or while stored.
        isOurs: () => released || ours(),
      });
    } finally {
      inFlight.current = false;
      setIsCheckingStatus(false);
    }
  };
  return { checkStatus, isCheckingStatus };
}
