import * as Crypto from 'expo-crypto';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import {
  isPinCancelled,
  type PinProofRequester,
  runWithPinProof,
} from '@/lib/wallet-pin-proof';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import {
  type ContributionRail,
  getErrorCode,
  resolveStoredOperation,
} from './stored-contribution-operation';

const PIN_CLOSED_MESSAGE =
  "Your goal was created. Add money to it from your wallet when you're ready.";

/**
 * Moves the first contribution of a created goal, bound to the rail of the
 * attempt that owns the stored operation id (see resolveStoredOperation).
 * Module scope so the hook stays small; the caller owns the in-flight flag.
 */
export async function runBankTransferContribution(
  input: UseStartSavingsSubmitInput,
  goalId: string,
  amount: number,
  ctx: { isMounted: () => boolean; requestPinProof?: PinProofRequester }
): Promise<void> {
  try {
    // The live verdict follows a rollback (Codex): the allowlist alone would
    // debit PiggyVest while the form shows the restored legacy balance.
    const verdictNow = readPiggyvestCapabilityNow(input.activeMerchantId);
    const isPrimary =
      isPiggyvestPrimaryMerchant(input.activeMerchantId) &&
      verdictNow !== false;
    const storedKey = input.initialContributionIdempotencyKey;
    // The rail is persisted with the stored id (same state, same scope,
    // cleared together). A truly unrecorded id is only an id from before the
    // rail was recorded; none exist, because primary has been dark. With no
    // record, SAVINGS_NOT_READY from the status read stays fail-closed on
    // purpose: the server cannot prove no primary transfer exists for it.
    const stored = await resolveStoredOperation({
      merchantId: input.activeMerchantId,
      operationId: storedKey,
      rail: input.initialContributionRail ?? null,
    });
    if (!ctx.isMounted()) return;
    if (stored.unknown) {
      // A settled transfer may hide behind a transient error; resubmitting
      // could debit twice through the other rail. Keep the id.
      const message =
        'Could not confirm your earlier transfer. Check again in a moment before trying another payment.';
      input.setFormError(message);
      showAppAlert({
        title: 'Status unavailable',
        message,
        variant: 'error',
      });
      return;
    }
    // A kept id retries on its original rail; a fresh id starts on the
    // rail the customer is currently on.
    const rail: ContributionRail =
      stored.rail ?? (isPrimary ? 'primary' : 'legacy');
    // A rollback's ruling-out just expired: the form still validates against
    // the legacy balance, so a fresh id waits for the verdict instead of
    // debiting PiggyVest (same hold as the wallet screen).
    if (
      !stored.rail &&
      rail === 'primary' &&
      verdictNow === null &&
      input.activeMerchantId &&
      wasPiggyvestLastRuledOut(input.activeMerchantId)
    ) {
      const message = 'We are checking your wallet. Please try again shortly.';
      input.setFormError(message);
      showAppAlert({ title: 'Still checking', message, variant: 'info' });
      return;
    }
    if (rail === 'primary' && !isPrimary && !stored.confirmed) {
      // The original rail is no longer available and the id must never
      // move to legacy: keep it and wait.
      const message =
        'We are checking your earlier contribution. Please try again later.';
      input.setFormError(message);
      showAppAlert({
        title: 'Still checking',
        message,
        variant: 'info',
      });
      return;
    }
    const idempotencyKey = stored.operationId ?? Crypto.randomUUID();
    if (!stored.operationId) {
      input.setInitialContributionIdempotencyKey(idempotencyKey);
    }
    let usedRail: ContributionRail = rail;
    // Written before the request so a restart mid-flight resumes on this rail.
    input.setInitialContributionRail?.(idempotencyKey, rail);
    // Primary-rail operations move money main wallet -> goal through
    // PiggyVest (stable operation id); the helper reports through onRail if
    // it falls back to legacy on SAVINGS_NOT_READY, and that rail sticks.
    const contribute =
      rail === 'primary'
        ? addPiggyvestPrimarySavingsContribution
        : addSavingsContribution;
    // A confirmed stored operation is complete: submitting it again could
    // fall back to the legacy rail and debit twice.
    const contributionResult: {
      status?: unknown;
      goalStatus?: unknown;
      operationId?: string;
    } = stored.confirmed
      ? { status: 'confirmed', operationId: idempotencyKey }
      : await runWithPinProof(
          (pinProof) =>
            contribute({
              amount,
              goalId,
              idempotencyKey,
              merchantId: input.activeMerchantId,
              merchantSlug: input.activeMerchantSlug,
              ...(rail === 'primary'
                ? {
                    // An id the server already knows on primary never goes to
                    // legacy: only a fresh id may fall back.
                    allowLegacyFallback: !stored.operationId,
                    onRail: (used: ContributionRail) => {
                      usedRail = used;
                      input.setInitialContributionRail?.(idempotencyKey, used);
                    },
                    // A clean "PIN needed" refusal opens the PIN sheet and
                    // retries this same id on this same rail with the proof.
                    ...(pinProof ? { pinProof } : {}),
                  }
                : {}),
            }),
          {
            merchantId: input.activeMerchantId,
            goalId,
            operationId: idempotencyKey,
            amountKobo: Math.round(amount * 100),
          },
          rail === 'primary' ? ctx.requestPinProof : undefined
        );
    if (!ctx.isMounted()) return;
    const outcome = contributionResult.status;
    if (outcome === 'pending' || outcome === 'cancelled') {
      // Never "funded" until PiggyVest confirms. Pending keeps the stored
      // operation id so a retry cannot double-spend; cancelled releases it.
      if (outcome === 'cancelled') {
        input.setInitialContributionIdempotencyKey(null);
      }
      input.setFormError(null);
      showAppAlert({
        title:
          outcome === 'pending' ? 'Transfer pending' : 'Transfer cancelled',
        message:
          outcome === 'pending'
            ? 'Your plan will update after PiggyVest confirms the transfer. No new payment has been started.'
            : 'The transfer was cancelled and your reserved wallet funds were released. You can try again.',
        variant: outcome === 'pending' ? 'info' : 'error',
      });
      try {
        await input.refetch();
      } catch {
        // Refresh is best effort; the pending state is already shown.
      }
      return;
    }
    // Completion reconciliation for the deferred path: the reminder was
    // retained at creation because the transfer was unconfirmed — now that
    // a confirmed contribution completes the goal, cancel it.
    // The primary response carries no goalStatus, so a confirmed primary
    // transfer that covers the target counts as completion.
    if (
      contributionResult.goalStatus === 'completed' ||
      (usedRail === 'primary' && amount >= input.targetValue)
    ) {
      try {
        await cancelSavingsReminderNotification(goalId);
      } catch {
        // Reminder cleanup is best effort after a confirmed contribution.
      }
    }
    input.setInitialContributionIdempotencyKey(null);
    input.setCreatedGoalId?.(null);
    input.setShowTransferModal(false);
    input.setFormError(null);
    input.setShowSuccessModal(true);
    try {
      await input.refetch();
    } catch {
      input.setFormError('Plan funded but unable to refresh wallet data.');
    }
  } catch (error) {
    if (!ctx.isMounted()) return;
    // The customer closed the PIN sheet: nothing was sent and the id and rail
    // stay for the next attempt. Say plainly that the goal already exists.
    if (isPinCancelled(error)) {
      input.setFormError(PIN_CLOSED_MESSAGE);
      showAppAlert({
        title: 'Goal created',
        message: PIN_CLOSED_MESSAGE,
        variant: 'info',
      });
      return;
    }
    if (getErrorCode(error) === 'WALLET_UNAVAILABLE') {
      // The server cancelled the reservation; the id can never be reused.
      input.setInitialContributionIdempotencyKey(null);
    }
    // A clean refusal: nothing moved, so the id and rail stay as they are and
    // nothing is retried.
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unable to record the contribution.';
    input.setFormError(message);
    showAppAlert({
      title: 'Contribution not recorded',
      message,
      variant: 'error',
    });
  }
}
