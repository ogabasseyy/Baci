import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type { WalletPayNotice, WalletPayNoticeTone } from './wallet-pay-notice';

type WalletColors = (typeof Colors)['light'];

const ICONS: Record<WalletPayNoticeTone, IoniconsIconName> = {
  success: 'checkmark-circle',
  info: 'information-circle',
  warning: 'alert-circle',
};

function toneColor(tone: WalletPayNoticeTone, colors: WalletColors) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  return colors.primary;
}

/**
 * A wallet payment outcome as a calm card, in the savings sheet's notice
 * language (tinted card, icon, title and one plain sentence).
 */
export function WalletPayNoticeCard({
  colors,
  notice,
}: {
  colors: WalletColors;
  notice: WalletPayNotice;
}) {
  const tint = toneColor(notice.tone, colors);
  return (
    <View
      accessibilityRole="alert"
      testID="wallet-pay-notice"
      style={[styles.card, { backgroundColor: withAlpha(tint, 0.1) }]}
    >
      <Ionicons name={ICONS[notice.tone]} size={20} color={tint} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>
          {notice.title}
        </Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {notice.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700' },
  message: { fontSize: 13, lineHeight: 19 },
});
