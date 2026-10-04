import type { z } from 'zod';
import {
  clearTerminalSavingsCardContributionSnapshot,
  readSavingsCardContributionSnapshot,
  type SavingsCardContributionSnapshot,
} from '@/lib/savings-card-contribution-snapshot';
import type { SavingsCardContributionOperationSchema } from '@/schemas/savings-card-contributions';
import { refreshSavedCardMethods } from './refresh-saved-card-methods';
import { syncSavingsCardContributionStatus } from './savings-card-contribution-status';

type Operation = z.infer<typeof SavingsCardContributionOperationSchema>;

export async function initializeSavingsCardContribution({
  goalId,
  isCurrent,
  onAmountChange,
  refreshWallet,
  scope,
  setAllowRetry,
  setCapabilityLoaded,
  setEnabled,
  setLoading,
  setMaximumAmountKobo,
  setMessage,
  setMethods,
  setOperation,
  setSelectedMethodId,
  setSnapshot,
  signal,
}: {
  goalId: string;
  isCurrent: () => boolean;
  onAmountChange: (value: string) => void;
  refreshWallet?: () => Promise<unknown> | undefined;
  scope: { userId: string; merchantId: string; goalId: string };
  setAllowRetry: (value: boolean) => void;
  setCapabilityLoaded: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setMaximumAmountKobo: (value: number) => void;
  setMessage: (value: string) => void;
  setMethods: (
    value: Array<{ id: string; brand: string; last4: string }>
  ) => void;
  setOperation: (value: Operation) => void;
  setSelectedMethodId: (value: string) => void;
  setSnapshot: (value: SavingsCardContributionSnapshot | null) => void;
  signal: AbortSignal;
}) {
  let restored: SavingsCardContributionSnapshot | null = null;
  try {
    restored = await readSavingsCardContributionSnapshot(scope);
    if (!isCurrent()) return;
    setSnapshot(restored);
    if (restored) {
      setSelectedMethodId(restored.savedMethodId);
      onAmountChange(String(restored.amountKobo / 100));
      await syncSavingsCardContributionStatus({
        goalId,
        isCurrent,
        refreshWallet,
        setAllowRetry,
        setMessage,
        setOperation,
        signal,
        snapshot: restored,
      });
      if (!isCurrent()) return;
    }
    await refreshSavedCardMethods({
      goalId,
      isCurrent,
      signal,
      onUnavailable: () => {
        setMessage(
          restored
            ? 'Card capability is unavailable. Your saved request remains unchanged; check status before retrying.'
            : 'Card contributions are temporarily unavailable.'
        );
        if (restored) setAllowRetry(true);
      },
      setCapabilityLoaded,
      setEnabled,
      setMaximumAmountKobo,
      setMethods,
    });
  } catch {
    if (!isCurrent()) return;
    setMessage(
      'Saved request state is unavailable. No new contribution can be started.'
    );
  } finally {
    if (isCurrent()) setLoading(false);
  }
}

export function refreshSavingsCardContributionMethods({
  goalId,
  isCurrent,
  setCapabilityLoaded,
  setEnabled,
  setMaximumAmountKobo,
  setMessage,
  setMethods,
}: {
  goalId: string;
  isCurrent: () => boolean;
  setCapabilityLoaded: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  setMaximumAmountKobo: (value: number) => void;
  setMessage: (value: string) => void;
  setMethods: (
    value: Array<{ id: string; brand: string; last4: string }>
  ) => void;
}) {
  return refreshSavedCardMethods({
    goalId,
    isCurrent,
    onUnavailable: () =>
      setMessage(
        'Saved cards are temporarily unavailable. Refresh to try again.'
      ),
    setCapabilityLoaded,
    setEnabled,
    setMaximumAmountKobo,
    setMethods,
  });
}

export async function prepareNewSavingsCardContribution({
  isCurrent,
  onAmountChange,
  operationStatus,
  scope,
  setMessage,
  setOperation,
  setSelectedMethodId,
  setSnapshot,
  snapshot,
}: {
  isCurrent: () => boolean;
  onAmountChange: (value: string) => void;
  operationStatus: 'completed' | 'collection_failed';
  scope: { userId: string; merchantId: string; goalId: string };
  setMessage: (value: string) => void;
  setOperation: (value: null) => void;
  setSelectedMethodId: (value: string) => void;
  setSnapshot: (value: null) => void;
  snapshot: SavingsCardContributionSnapshot;
}) {
  try {
    await clearTerminalSavingsCardContributionSnapshot(
      scope,
      snapshot.idempotencyKey,
      operationStatus
    );
    if (!isCurrent()) return;
    setSnapshot(null);
    setOperation(null);
    setSelectedMethodId('');
    onAmountChange('');
    setMessage(
      'Choose a saved card and amount for a new one-time contribution.'
    );
  } catch {
    if (isCurrent())
      setMessage(
        'Unable to replace the completed request safely. Check its status again.'
      );
  }
}
