import {
  resolveAssuranceDefault,
  resolveAssuranceLabel,
} from '@baci/shared/lib';
import { StyleSheet, Text } from 'react-native';
import type Colors from '@/constants/Colors';
import { useMerchantPaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';

type ColorsScheme = (typeof Colors)['light'];

interface StickyAssuranceDefaultNoteProps {
  canPurchase: boolean;
  quantityInCart: number;
  colors: ColorsScheme;
}

/**
 * Discloses the assurance default under the sticky add-to-cart button.
 * Mounting the payment-settings query both warms the cache the cart
 * add path reads and re-renders this note when the live toggle
 * resolves. Shows only when a fresh add would default the fee on; the
 * cart line itself shows the exact fee with a toggle.
 */
export function StickyAssuranceDefaultNote({
  canPurchase,
  quantityInCart,
  colors,
}: StickyAssuranceDefaultNoteProps) {
  const { data: settings } = useMerchantPaymentSettings();
  const visible =
    canPurchase &&
    quantityInCart === 0 &&
    resolveAssuranceDefault({
      smartCartProEnabled: CONFIG.ENABLE_SMART_CART_PRO,
      merchantSlug: CONFIG.MERCHANT_SLUG,
      shippingInsuranceEnabled: settings?.shipping_insurance_enabled,
    });
  if (!visible) {
    return null;
  }
  return (
    <Text
      testID="assurance-default-note"
      style={[styles.note, { color: colors.textSecondary }]}
    >
      Includes {resolveAssuranceLabel(CONFIG.MERCHANT_SLUG)} — review or remove
      it in your cart.
    </Text>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
});
