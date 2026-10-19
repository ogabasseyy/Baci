import { getSavingsCardContributionOptions } from '@/lib/savings-card-contributions';

export async function refreshSavedCardMethods({
  goalId,
  isCurrent,
  onUnavailable,
  signal,
  setCapabilityLoaded,
  setEnabled,
  setMaximumAmountKobo,
  setMethods,
}: {
  goalId: string;
  isCurrent: () => boolean;
  onUnavailable: () => void;
  signal?: AbortSignal;
  setCapabilityLoaded: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  setMaximumAmountKobo: (value: number) => void;
  setMethods: (
    value: Array<{ id: string; brand: string; last4: string }>
  ) => void;
}) {
  try {
    const options = await getSavingsCardContributionOptions({ goalId, signal });
    if (!isCurrent()) return;
    setMethods(options.savedMethods);
    setMaximumAmountKobo(options.maximumAmountKobo);
    setEnabled(options.enabled && options.newCardEnabled === false);
    setCapabilityLoaded(true);
  } catch {
    if (isCurrent()) onUnavailable();
  }
}
