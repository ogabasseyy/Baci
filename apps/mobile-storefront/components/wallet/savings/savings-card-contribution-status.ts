import type { z } from 'zod';
import type { SavingsCardContributionSnapshot } from '@/lib/savings-card-contribution-snapshot';
import { getSavingsCardContributionStatus } from '@/lib/savings-card-contributions';
import type { SavingsCardContributionOperationSchema } from '@/schemas/savings-card-contributions';
import { savingsCardContributionUtils } from './savings-card-contribution-utils';

type Operation = z.infer<typeof SavingsCardContributionOperationSchema>;

export async function syncSavingsCardContributionStatus({
  expectedOperationId,
  goalId,
  isCurrent,
  refreshWallet,
  setAllowRetry,
  setMessage,
  setOperation,
  signal,
  snapshot,
}: {
  expectedOperationId?: string;
  goalId: string;
  isCurrent: () => boolean;
  refreshWallet?: () => Promise<unknown> | undefined;
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
  controllers,
  expectedOperationId,
  goalId,
  isCurrent,
  refreshWallet,
  setAllowRetry,
  setBusy,
  setMessage,
  setOperation,
  snapshot,
}: {
  allowBusy: boolean;
  busyRef: { current: boolean };
  controllers: Set<AbortController>;
  expectedOperationId?: string;
  goalId: string;
  isCurrent: () => boolean;
  refreshWallet?: () => Promise<unknown> | undefined;
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
      expectedOperationId,
      goalId,
      isCurrent: () => !controller.signal.aborted && isCurrent(),
      refreshWallet,
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
