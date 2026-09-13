import type { ComponentProps } from 'react';
import { CheckoutCryptoPaymentModal } from './CheckoutCryptoPaymentModal';
import { CryptoSelectionModal } from './CryptoSelectionModal';
import type { useCheckoutCryptoPayment } from './use-checkout-crypto-payment';

interface Props {
  crypto: ReturnType<typeof useCheckoutCryptoPayment>;
  clearCart: ComponentProps<typeof CheckoutCryptoPaymentModal>['clearCart'];
  colors: ComponentProps<typeof CheckoutCryptoPaymentModal>['colors'];
  isProcessing: boolean;
}

export function CheckoutPaymentOverlays({
  crypto,
  clearCart,
  colors,
  isProcessing,
}: Props) {
  return (
    <>
      <CryptoSelectionModal
        visible={crypto.showCryptoSelection}
        onClose={() => crypto.setShowCryptoSelection(false)}
        onConfirm={crypto.handleCryptoConfirm}
        isProcessing={isProcessing}
      />
      <CheckoutCryptoPaymentModal
        clearCart={clearCart}
        colors={colors}
        cryptoPayment={crypto.cryptoPayment}
        onChangeSelection={() => {
          crypto.setCryptoPayment(null);
          crypto.setShowCryptoSelection(true);
        }}
        onClosePayment={() => crypto.setCryptoPayment(null)}
      />
    </>
  );
}
