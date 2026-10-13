import { getSavingsFirstCardCapability } from '@/lib/savings-first-card-checkout';
import {
  readSavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardScope,
} from '@/lib/savings-first-card-checkout-snapshot';
import type { SavingsFirstCardCheckoutStatus } from '@/schemas/savings-first-card-checkout';

export async function initializeSavingsFirstCardCheckout({
  amountChange,
  activation,
  isCurrent,
  refreshStatus,
  requestScope,
  requestScopeKey,
  setAllowRetry,
  setEnabled,
  setLoading,
  setMaximumAmountKobo,
  setMessage,
  setRecoveryBlocked,
  setSnapshot,
  setStatus,
  signal,
}: {
  amountChange: (amount: string) => void;
  activation: number;
  isCurrent: (key: string, activation: number) => boolean;
  refreshStatus: (
    snapshot: SavingsFirstCardCheckoutSnapshot,
    key: string,
    activation: number,
    scope: SavingsFirstCardScope
  ) => Promise<void>;
  requestScope: SavingsFirstCardScope;
  requestScopeKey: string;
  setAllowRetry: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setMaximumAmountKobo: (value: number) => void;
  setMessage: (value: string) => void;
  setRecoveryBlocked: (value: boolean) => void;
  setSnapshot: (value: SavingsFirstCardCheckoutSnapshot) => void;
  setStatus: (value: SavingsFirstCardCheckoutStatus | null) => void;
  signal: AbortSignal;
}) {
  setRecoveryBlocked(false);
  let restored: SavingsFirstCardCheckoutSnapshot | null;
  try {
    restored = await readSavingsFirstCardCheckoutSnapshot(requestScope);
  } catch {
    if (isCurrent(requestScopeKey, activation)) {
      setRecoveryBlocked(true);
      setEnabled(false);
      setMessage(
        'Saved checkout data cannot be read. No new card charge can start.'
      );
      setLoading(false);
    }
    return;
  }
  if (!isCurrent(requestScopeKey, activation) || signal.aborted) return;
  if (restored) {
    setSnapshot(restored);
    setStatus(restored.status ?? null);
    amountChange(String(restored.amountKobo / 100));
    if (restored.intentId) {
      await refreshStatus(restored, requestScopeKey, activation, requestScope);
    } else {
      setMessage(
        'A saved checkout request needs recovery. Retry uses the same request key.'
      );
      setAllowRetry(true);
    }
  }
  try {
    const capability = await getSavingsFirstCardCapability({
      goalId: requestScope.goalId,
      signal,
    });
    if (!isCurrent(requestScopeKey, activation)) return;
    setEnabled(capability.enabled);
    setMaximumAmountKobo(capability.maximumAmountKobo);
  } catch {
    if (isCurrent(requestScopeKey, activation)) setEnabled(false);
  } finally {
    if (isCurrent(requestScopeKey, activation)) setLoading(false);
  }
}
