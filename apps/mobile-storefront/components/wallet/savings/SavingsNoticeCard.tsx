import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type { SavingsNoticeTone } from './savings-notice-store';
import { useSavingsNotice } from './use-savings-notice';

type WalletColors = (typeof Colors)['light'];

const ICONS: Record<SavingsNoticeTone, IoniconsIconName> = {
  success: 'checkmark-circle',
  info: 'information-circle',
  warning: 'alert-circle',
};

function toneColor(tone: SavingsNoticeTone, colors: WalletColors) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  return colors.primary;
}

/** The latest savings outcome as a calm, dismissible card. */
export function SavingsNoticeCard({
  colors,
  goalId,
  style,
}: {
  colors: WalletColors;
  /** The goal on screen: another goal's notice is never shown here. */
  goalId?: string | null;
  /** Outer spacing: the wallet insets it like its cards; the sheet doesn't. */
  style?: StyleProp<ViewStyle>;
}) {
  const { notice, clear } = useSavingsNotice(goalId);
  if (!notice) return null;
  const tint = toneColor(notice.tone, colors);
  return (
    <View
      accessibilityRole="alert"
      testID="savings-notice"
      style={[styles.card, { backgroundColor: withAlpha(tint, 0.1) }, style]}
    >
      <Ionicons name={ICONS[notice.tone]} size={20} color={tint} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>
          {notice.title}
        </Text>
        {notice.message ? (
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {notice.message}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message"
        hitSlop={8}
        onPress={clear}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
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
