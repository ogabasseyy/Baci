import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

interface ApplyWalletRouteActionParams {
  routeAction: string | undefined;
  openBankTransferPanel?: boolean;
  routeRequiredAmount: string;
  walletReturnTo: WalletReturnHref | undefined;
  setFundAmount: (value: string) => void;
  setFundReturnTo: (value: WalletReturnHref | undefined) => void;
  setShowFundPanel: (value: boolean) => void;
  setShowRedeemPanel: (value: boolean) => void;
  setShowSavingsProgressModal: (value: boolean) => void;
}

/**
 * Resolves a wallet route action to exactly one open panel, fully closing the
 * others so a stale fund/redeem/savings surface can't overlap the new one.
 * Extracted from WalletScreen to keep that screen within the module-size
 * budget; pure aside from the injected setters.
 */
export function applyWalletRouteAction({
  routeAction,
  openBankTransferPanel = false,
  routeRequiredAmount,
  walletReturnTo,
  setFundAmount,
  setFundReturnTo,
  setShowFundPanel,
  setShowRedeemPanel,
  setShowSavingsProgressModal,
}: ApplyWalletRouteActionParams) {
  if (routeAction === 'fund') {
    setShowFundPanel(true);
    setShowRedeemPanel(false);
    setShowSavingsProgressModal(false);
    setFundAmount(routeRequiredAmount);
    setFundReturnTo(walletReturnTo);
    return;
  }
  if (routeAction === 'redeem') {
    setShowFundPanel(false);
    setShowRedeemPanel(true);
    setShowSavingsProgressModal(false);
    setFundAmount('');
    setFundReturnTo(undefined);
    return;
  }
  if (routeAction === 'bank-transfer') {
    setShowFundPanel(openBankTransferPanel);
    setShowRedeemPanel(false);
    setShowSavingsProgressModal(false);
    setFundAmount('');
    setFundReturnTo(walletReturnTo);
    return;
  }
  if (routeAction === 'savings') {
    setShowFundPanel(false);
    setShowRedeemPanel(false);
    setShowSavingsProgressModal(true);
    setFundAmount('');
    setFundReturnTo(undefined);
  }
}
