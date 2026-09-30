import type { useCheckoutCryptoSession } from '../hooks/use-checkout-crypto-session';
import type { DvaModalData } from '../hooks/use-dva-confirm-transfer';
import type { useWalletFundedBankTransfer } from '../hooks/use-wallet-funded-bank-transfer';
import { CheckoutPaymentOverlays } from './CheckoutPaymentOverlays';

export type CheckoutCryptoOverlaySession = Pick<
  ReturnType<typeof useCheckoutCryptoSession>,
  | 'changeChain'
  | 'changeCurrency'
  | 'closeSelector'
  | 'cryptoPaymentData'
  | 'cryptoVerificationStatus'
  | 'dismissCryptoModal'
  | 'initializeCryptoPayment'
  | 'isInitializingCrypto'
  | 'isVerifyingCrypto'
  | 'selectedCryptoChain'
  | 'selectedCryptoCurrency'
  | 'showCryptoSelector'
  | 'supportedChains'
  | 'verifyCryptoPayment'
>;

export type WalletFundedTransferOverlaySession = Pick<
  ReturnType<typeof useWalletFundedBankTransfer>,
  | 'acceptConsent'
  | 'account'
  | 'checkNow'
  | 'close'
  | 'consentRequested'
  | 'declineConsent'
  | 'error'
  | 'intent'
  | 'isChecking'
>;

interface CheckoutPaymentSessionOverlaysProps {
  crypto: CheckoutCryptoOverlaySession;
  walletFundedTransfer: WalletFundedTransferOverlaySession;
  dva: {
    data: DvaModalData | null;
    isVerifying: boolean;
    onClose: () => void;
    onConfirmTransfer: () => void;
  };
  merchantName?: string | null;
  formatCurrency: (amount: number) => string;
}

export function CheckoutPaymentSessionOverlays({
  crypto,
  walletFundedTransfer,
  dva,
  merchantName,
  formatCurrency,
}: CheckoutPaymentSessionOverlaysProps) {
  return (
    <CheckoutPaymentOverlays
      cryptoSelector={
        crypto.showCryptoSelector
          ? {
              selectedCryptoCurrency: crypto.selectedCryptoCurrency,
              selectedCryptoChain: crypto.selectedCryptoChain,
              supportedChains: crypto.supportedChains,
              isInitializingCrypto: crypto.isInitializingCrypto,
              onCurrencyChange: crypto.changeCurrency,
              onChainChange: crypto.changeChain,
              onInitialize: crypto.initializeCryptoPayment,
              onClose: crypto.closeSelector,
            }
          : undefined
      }
      cryptoPayment={
        crypto.cryptoPaymentData
          ? {
              data: crypto.cryptoPaymentData,
              verificationStatus: crypto.cryptoVerificationStatus,
              isVerifying: crypto.isVerifyingCrypto,
              onVerify: crypto.verifyCryptoPayment,
              onClose: crypto.dismissCryptoModal,
            }
          : undefined
      }
      walletTransfer={{
        consent: walletFundedTransfer.consentRequested
          ? {
              merchantName: merchantName || 'This store',
              onAccept: walletFundedTransfer.acceptConsent,
              onDecline: walletFundedTransfer.declineConsent,
            }
          : undefined,
        funding:
          walletFundedTransfer.account && walletFundedTransfer.intent
            ? {
                account: walletFundedTransfer.account,
                error: walletFundedTransfer.error,
                formatCurrency,
                intent: walletFundedTransfer.intent,
                isChecking: walletFundedTransfer.isChecking,
                onCheckNow: walletFundedTransfer.checkNow,
                onClose: walletFundedTransfer.close,
              }
            : undefined,
      }}
      dva={
        dva.data
          ? {
              data: dva.data,
              formatCurrency,
              isVerifying: dva.isVerifying,
              onClose: dva.onClose,
              onConfirmTransfer: dva.onConfirmTransfer,
            }
          : undefined
      }
    />
  );
}
