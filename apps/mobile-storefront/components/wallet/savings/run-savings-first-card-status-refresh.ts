import { getSavingsFirstCardCapability } from '@/lib/savings-first-card-checkout';
import {
  clearRetiredSavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardScope,
} from '@/lib/savings-first-card-checkout-snapshot';
import { refreshSavedSavingsFirstCardStatus } from './refresh-savings-first-card-status';

export async function runSavingsFirstCardStatusRefresh({
  activation,
  isCurrent,
  onCompleted,
  refreshWallet,
  requestScope,
  requestScopeKey,
  setAllowRetry,
  setEnabled,
  setMaximumAmountKobo,
  setMessage,
  setSnapshot,
  setStatus,
  snapshot,
  statusRequestRef,
}: {
  activation: number;
  isCurrent: (key: string, activation: number) => boolean;
  onCompleted?: () => Promise<unknown> | undefined;
  refreshWallet: () => Promise<unknown> | undefined;
  requestScope: SavingsFirstCardScope;
  requestScopeKey: string;
  setAllowRetry: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  setMaximumAmountKobo: (value: number) => void;
  setMessage: (value: string) => void;
  setSnapshot: (value: SavingsFirstCardCheckoutSnapshot | null) => void;
  setStatus: (
    value: NonNullable<SavingsFirstCardCheckoutSnapshot['status']>
  ) => void;
  snapshot: SavingsFirstCardCheckoutSnapshot;
  statusRequestRef: { current: Promise<void> | null };
}) {
  await refreshSavedSavingsFirstCardStatus({
    activation,
    clearRetiredSnapshot: clearRetiredSavingsFirstCardCheckoutSnapshot,
    isCurrent,
    onCompleted,
    refreshWallet,
    refreshCapability: async () => {
      try {
        const capability = await getSavingsFirstCardCapability({
          goalId: requestScope.goalId,
        });
        if (!isCurrent(requestScopeKey, activation)) return;
        setEnabled(capability.enabled);
        setMaximumAmountKobo(capability.maximumAmountKobo);
      } catch {
        if (!isCurrent(requestScopeKey, activation)) return;
        setEnabled(false);
        setMaximumAmountKobo(0);
      }
    },
    requestScope,
    requestScopeKey,
    setAllowRetry,
    setMessage,
    setSnapshot,
    setStatus,
    snapshot,
    statusRequestRef,
  });
}
