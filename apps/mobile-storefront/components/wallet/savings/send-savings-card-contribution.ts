import type { SavingsCardContributionSnapshot as Snapshot } from '@/lib/savings-card-contribution-snapshot';
import { submitSavingsCardContribution } from '@/lib/savings-card-contributions';

export async function sendSavingsCardContributionSnapshot({
  activation,
  busyRef,
  controllers,
  goalId,
  isCurrent,
  readStatus,
  reserved,
  setAllowRetry,
  setBusy,
  setMessage,
  setReviewing,
  snapshot,
}: {
  activation: number;
  busyRef: { current: boolean };
  controllers: Set<AbortController>;
  goalId: string;
  isCurrent: () => boolean;
  readStatus: (
    currentSnapshot: Snapshot,
    allowBusy: boolean,
    activation: number
  ) => Promise<unknown>;
  reserved: boolean;
  setAllowRetry: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setMessage: (value: string) => void;
  setReviewing: (value: boolean) => void;
  snapshot: Snapshot;
}) {
  if (busyRef.current && !reserved) return;
  if (!isCurrent() || snapshot.goalId !== goalId) return;
  busyRef.current = true;
  setBusy(true);
  setAllowRetry(false);
  setMessage('');
  const controller = new AbortController();
  controllers.add(controller);
  const active = () => !controller.signal.aborted && isCurrent();
  try {
    await submitSavingsCardContribution({
      request: snapshot,
      signal: controller.signal,
    });
    if (!active()) return;
    setReviewing(false);
    busyRef.current = false;
    setBusy(false);
    await readStatus(snapshot, true, activation);
  } catch {
    if (active()) {
      setMessage(
        'We could not confirm the request. Your saved request is unchanged; retry uses the same key.'
      );
      setAllowRetry(true);
    }
  } finally {
    controllers.delete(controller);
    if (active()) {
      busyRef.current = false;
      setBusy(false);
    }
  }
}
