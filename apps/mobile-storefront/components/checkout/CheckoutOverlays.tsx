import { Platform } from 'react-native';
import { CheckoutLocationPickerOverlays } from './CheckoutLocationPickerOverlays';
import { CheckoutPaymentOverlays } from './CheckoutPaymentOverlays';
import { RedvaultOrderReview } from './redvault/RedvaultOrderReview';

/** Modal/picker overlays rendered above the checkout step content. */
export function CheckoutOverlays({
  redvaultReview,
  closeRedvaultReview,
  colors,
  isDark,
  shipping,
  watchedCity,
  watchedState,
  crypto,
  clearCart,
  isProcessing,
}: {
  redvaultReview: Parameters<typeof RedvaultOrderReview>[0]['input'];
  closeRedvaultReview: () => void;
  colors: Parameters<typeof CheckoutLocationPickerOverlays>[0]['colors'];
  isDark: boolean;
  shipping: Parameters<typeof CheckoutLocationPickerOverlays>[0]['shipping'];
  watchedCity: Parameters<
    typeof CheckoutLocationPickerOverlays
  >[0]['watchedCity'];
  watchedState: Parameters<
    typeof CheckoutLocationPickerOverlays
  >[0]['watchedState'];
  crypto: Parameters<typeof CheckoutPaymentOverlays>[0]['crypto'];
  clearCart: Parameters<typeof CheckoutPaymentOverlays>[0]['clearCart'];
  isProcessing: boolean;
}) {
  return (
    <>
      <RedvaultOrderReview
        input={redvaultReview}
        onClose={closeRedvaultReview}
      />
      <CheckoutLocationPickerOverlays
        colors={colors}
        isDark={isDark}
        removeClippedSubviews={Platform.OS === 'android'}
        shipping={shipping}
        watchedCity={watchedCity}
        watchedState={watchedState}
      />
      <CheckoutPaymentOverlays
        crypto={crypto}
        clearCart={clearCart}
        colors={colors}
        isProcessing={isProcessing}
      />
    </>
  );
}
