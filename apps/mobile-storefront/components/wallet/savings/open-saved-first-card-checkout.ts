import { openSavingsFirstCardBrowser } from '@/lib/savings-first-card-browser';
import type {
  SavingsFirstCardCheckoutSnapshot,
  SavingsFirstCardScope,
} from '@/lib/savings-first-card-checkout-snapshot';

export async function openSavedFirstCardCheckout({
  activation,
  isCurrent,
  onClosed,
  onUnavailable,
  requestScope,
  requestScopeKey,
  snapshot,
}: {
  activation: number;
  isCurrent: (key: string, activation: number) => boolean;
  onClosed: (
    snapshot: SavingsFirstCardCheckoutSnapshot,
    key: string,
    activation: number,
    scope: SavingsFirstCardScope
  ) => Promise<void>;
  onUnavailable: () => void;
  requestScope: SavingsFirstCardScope;
  requestScopeKey: string;
  snapshot: SavingsFirstCardCheckoutSnapshot;
}) {
  if (!isCurrent(requestScopeKey, activation)) return;
  if (
    !snapshot.intentId ||
    snapshot.status !== 'ready' ||
    !snapshot.authorizationUrl
  ) {
    if (snapshot.intentId)
      await onClosed(snapshot, requestScopeKey, activation, requestScope);
    return;
  }
  try {
    await openSavingsFirstCardBrowser(snapshot.authorizationUrl);
  } catch {
    if (isCurrent(requestScopeKey, activation)) onUnavailable();
  } finally {
    if (isCurrent(requestScopeKey, activation))
      await onClosed(snapshot, requestScopeKey, activation, requestScope);
  }
}
