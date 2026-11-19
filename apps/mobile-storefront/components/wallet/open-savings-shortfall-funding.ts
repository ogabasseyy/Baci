import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

// A savings shortfall is funded from the PiggyVest main wallet and returns to
// the savings flow, whatever funding link the screen was opened with before.
export const SAVINGS_SHORTFALL_RETURN_TO: WalletReturnHref =
  '/wallet?action=savings';

export function createOpenSavingsShortfallFunding(actions: {
  setFundReturnTo: (href: WalletReturnHref) => void;
  setShowFundPanel: (open: boolean) => void;
  setShowSavingsProgressModal: (open: boolean) => void;
}) {
  return () => {
    actions.setShowSavingsProgressModal(false);
    actions.setFundReturnTo(SAVINGS_SHORTFALL_RETURN_TO);
    actions.setShowFundPanel(true);
  };
}
