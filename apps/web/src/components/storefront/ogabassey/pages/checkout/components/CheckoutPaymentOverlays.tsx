'use client';

import type { ComponentProps } from 'react';
import { useCheckoutClipboardFeedback } from '../hooks/use-checkout-clipboard-feedback';
import { CryptoPaymentModal } from './CryptoPaymentModal';
import { DeferredCryptoSelectorModal } from './DeferredCryptoSelectorModal';
import { DeferredWalletFundedTransferModal } from './DeferredWalletFundedTransferModal';
import { DeferredWalletTransferConsentDialog } from './DeferredWalletTransferConsentDialog';
import { DvaModal } from './DvaModal';

type CryptoSelector = ComponentProps<typeof DeferredCryptoSelectorModal>;
type CryptoPayment = Omit<
  ComponentProps<typeof CryptoPaymentModal>,
  'copiedText' | 'onCopyToClipboard' | 'onCloseConfirm'
>;
type WalletConsent = ComponentProps<typeof DeferredWalletTransferConsentDialog>;
type WalletFunding = Omit<
  ComponentProps<typeof DeferredWalletFundedTransferModal>,
  'copiedText' | 'onCopy'
>;
type Dva = Omit<
  ComponentProps<typeof DvaModal>,
  'copiedText' | 'onCopyToClipboard'
>;

interface CheckoutPaymentOverlaysProps {
  cryptoSelector?: CryptoSelector;
  cryptoPayment?: CryptoPayment;
  walletTransfer: {
    consent?: WalletConsent;
    funding?: WalletFunding;
  };
  dva?: Dva;
}

export function CheckoutPaymentOverlays({
  cryptoSelector,
  cryptoPayment,
  walletTransfer,
  dva,
}: CheckoutPaymentOverlaysProps) {
  const { copiedText, copyToClipboard } = useCheckoutClipboardFeedback();

  return (
    <>
      {cryptoSelector && <DeferredCryptoSelectorModal {...cryptoSelector} />}
      {cryptoPayment && (
        <CryptoPaymentModal
          {...cryptoPayment}
          copiedText={copiedText}
          onCopyToClipboard={copyToClipboard}
          onCloseConfirm={() => {
            const confirmed = confirm(
              "Are you sure you want to close? If you've already sent payment, your order will still be processed once the payment is detected."
            );
            if (confirmed) cryptoPayment.onClose();
          }}
        />
      )}
      {walletTransfer.consent && (
        <DeferredWalletTransferConsentDialog {...walletTransfer.consent} />
      )}
      {walletTransfer.funding && (
        <DeferredWalletFundedTransferModal
          {...walletTransfer.funding}
          copiedText={copiedText}
          onCopy={copyToClipboard}
        />
      )}
      {dva && (
        <DvaModal
          {...dva}
          copiedText={copiedText}
          onCopyToClipboard={copyToClipboard}
        />
      )}
    </>
  );
}
