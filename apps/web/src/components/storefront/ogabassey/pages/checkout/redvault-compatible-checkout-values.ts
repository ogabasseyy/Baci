import type { PaymentMethod } from './types';

export function getRedvaultCompatibleCheckoutValues({
  baseTotal,
  discountAmount,
  discountCode,
  paymentMethod,
  payWithWallet,
  walletBalance,
  walletCurrencySupported,
}: {
  baseTotal: number;
  discountAmount: number;
  discountCode: string | null | undefined;
  paymentMethod: PaymentMethod;
  payWithWallet: boolean;
  walletBalance: number;
  walletCurrencySupported: boolean;
}) {
  const ordinaryCreditsAllowed = paymentMethod !== 'uba_redvault';
  const compatibleDiscountAmount = ordinaryCreditsAllowed ? discountAmount : 0;
  const total = Math.max(0, baseTotal - compatibleDiscountAmount);
  const walletAmountUsed =
    ordinaryCreditsAllowed && payWithWallet && walletCurrencySupported
      ? Math.min(walletBalance, total)
      : 0;

  return {
    discountAmount: compatibleDiscountAmount,
    discountCode: ordinaryCreditsAllowed ? discountCode ?? null : null,
    payWithWallet: ordinaryCreditsAllowed && payWithWallet,
    total,
    useWalletCredit: walletAmountUsed > 0,
    walletAmountUsed,
  };
}
