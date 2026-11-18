import { router } from 'expo-router';
import { navigateToStoreCreditTopUp } from '@/lib/navigate-to-store-credit-top-up';
import { navigateToWalletFunding } from '@/lib/navigate-to-wallet-funding';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import {
  getUtilityPayShortfall,
  type UtilityPayShortfall,
  type UtilityPayWalletSnapshot,
} from './utility-pay-readiness';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

export interface UtilityPayGate {
  /** Link that adds money when the balance is short (null otherwise). */
  action: { label: string; onPress: () => void } | null;
  /** Why Pay is disabled; null when the form can be submitted. */
  blockedReason: string | null;
}

function openTopUp(
  shortfall: UtilityPayShortfall,
  returnToHref: WalletReturnHref
) {
  if (shortfall.route === 'store-credit') {
    navigateToStoreCreditTopUp(shortfall.shortfall, returnToHref);
    return;
  }
  if (shortfall.route === 'bank-transfer') {
    navigateToWalletFunding(returnToHref);
    return;
  }
  router.push({ pathname: '/wallet' });
}

/**
 * Decides whether a utility form's Pay button can be pressed and what the
 * calm notice above it says: the form's own first issue (missing or invalid
 * field) wins, then a known shortfall of the chosen payment method. The
 * PiggyVest savings wallet counts as covering when the screen's host says it
 * pays, and a kept attempt replays whatever the balances say.
 */
export function useUtilityPayGate({
  amount,
  formIssue,
  payment,
  retained,
  returnToHref,
}: {
  amount: number;
  formIssue: string | null;
  payment: UtilityPayWalletSnapshot;
  retained: boolean;
  returnToHref: WalletReturnHref;
}): UtilityPayGate {
  const savingsCovers = useVtuWalletPayStore(
    (state) => amount > 0 && state.covers(amount)
  );
  if (formIssue) return { action: null, blockedReason: formIssue };
  const shortfall = getUtilityPayShortfall({
    amount,
    payment,
    retained,
    savingsCovers,
  });
  if (!shortfall) return { action: null, blockedReason: null };
  return {
    action: {
      label: shortfall.ctaLabel,
      onPress: () => openTopUp(shortfall, returnToHref),
    },
    blockedReason: shortfall.message,
  };
}
