import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

export const WALLET_TRANSFER_FALLBACK_COPY =
  "Bank transfer to wallet isn't available for this order, so it uses a one-time bank transfer instead.";

type WalletTransferFallbackNoticeProps = {
  colors: typeof Colors.light;
};

/**
 * Calm in-page notice for when the final check at Place Order switched
 * "Bank transfer to wallet" to a one-time bank transfer for this order.
 */
export function WalletTransferFallbackNotice({
  colors,
}: WalletTransferFallbackNoticeProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={[
        styles.notice,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name="information-circle-outline"
        size={18}
        color={colors.textSecondary}
      />
      <Text style={[styles.text, { color: colors.text }]}>
        {WALLET_TRANSFER_FALLBACK_COPY}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    padding: 12,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 18 },
});
