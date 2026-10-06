import type { z } from 'zod';
import type { SavingsCardContributionSnapshot } from '@/lib/savings-card-contribution-snapshot';
import { getSavingsCardContributionStatus } from '@/lib/savings-card-contributions';
import type { SavingsCardContributionOperationSchema } from '@/schemas/savings-card-contributions';
import { savingsCardContributionUtils } from './savings-card-contribution-utils';

type Operation = z.infer<typeof SavingsCardContributionOperationSchema>;

export async function syncSavingsCardContributionStatus({
  cancelSavingsReminder,
  expectedOperationId,
  goalId,
  isCurrent,
  refreshWallet,
  remainingAmountKobo,
  setAllowRetry,
  setMessage,
  setOperation,
  signal,
  snapshot,
}: {
  cancelSavingsReminder?: (goalId: string) => Promise<unknown>;
  expectedOperationId?: string;
  goalId: string;
  isCurrent: () => boolean;
  refreshWallet?: () => Promise<unknown> | undefined;
  remainingAmountKobo?: number;
  setAllowRetry: (value: boolean) => void;
  setMessage: (value: string) => void;
  setOperation: (value: Operation) => void;
  signal: AbortSignal;
  snapshot: SavingsCardContributionSnapshot;
}) {
  try {
    const status = await getSavingsCardContributionStatus({
      goalId,
      idempotencyKey: snapshot.idempotencyKey,
      signal,
    });
    if (!isCurrent()) return;
    if (
      status.goalId !== snapshot.goalId ||
      status.amountKobo !== snapshot.amountKobo ||
      (expectedOperationId && status.operationId !== expectedOperationId)
    ) {
      throw new Error('Saved contribution status does not match this request.');
    }
    setOperation(status);
    if (status.status === 'completed') {
      // Mirror the wallet-contribution path: when the completed charge
      // covers the plan's remaining amount, the goal is complete and its
      // recurring local reminder must stop. This runs before the refresh
      // below and is intentionally not gated on isCurrent: completion is
      // server truth for this goal, and the refresh can unmount this flow
      // (completed goals stop rendering the funding panel), which would
      // otherwise skip the cancellation and leave the reminder firing.
      if (
        remainingAmountKobo !== undefined &&
        snapshot.amountKobo >= remainingAmountKobo
      ) {
        try {
          await cancelSavingsReminder?.(goalId);
        } catch {
          // Reminder cleanup is best effort after a confirmed contribution.
        }
      }
      try {
        await refreshWallet?.();
      } catch {
        if (!isCurrent()) return;
      }
      if (!isCurrent()) return;
      setMessage(
        'Contribution completed. Refresh your wallet to see the latest balance.'
      );
      return;
    }
    setMessage(savingsCardContributionUtils.operationMessage(status));
  } catch {
    if (!isCurrent()) return;
    setMessage(
      'Status is unavailable. Your saved request is unchanged; check status before retrying.'
    );
    setAllowRetry(true);
  }
}

export async function readSavingsCardContributionStatus({
  allowBusy,
  busyRef,
  cancelSavingsReminder,
  controllers,
  expectedOperationId,
  goalId,
  isCurrent,
  refreshWallet,
  remainingAmountKobo,
  setAllowRetry,
  setBusy,
  setMessage,
  setOperation,
  snapshot,
}: {
  allowBusy: boolean;
  busyRef: { current: boolean };
  cancelSavingsReminder?: (goalId: string) => Promise<unknown>;
  controllers: Set<AbortController>;
  expectedOperationId?: string;
  goalId: string;
  isCurrent: () => boolean;
  refreshWallet?: () => Promise<unknown> | undefined;
  remainingAmountKobo?: number;
  setAllowRetry: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setMessage: (value: string) => void;
  setOperation: (value: Operation) => void;
  snapshot: SavingsCardContributionSnapshot | null;
}) {
  if (!snapshot || (busyRef.current && !allowBusy)) return;
  busyRef.current = true;
  setBusy(true);
  setAllowRetry(false);
  const controller = new AbortController();
  controllers.add(controller);
  try {
    await syncSavingsCardContributionStatus({
      cancelSavingsReminder,
      expectedOperationId,
      goalId,
      isCurrent: () => !controller.signal.aborted && isCurrent(),
      refreshWallet,
      remainingAmountKobo,
      setAllowRetry,
      setMessage,
      setOperation,
      signal: controller.signal,
      snapshot,
    });
  } finally {
    controllers.delete(controller);
    if (!controller.signal.aborted && isCurrent()) {
      busyRef.current = false;
      setBusy(false);
    }
  }
}
