import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { usePiggyvestSlowdown } from '@/hooks/use-piggyvest-slowdown';

export const PIGGYVEST_SLOWDOWN_MESSAGE =
  'Savings are running slowly right now. Your money is safe.';

/**
 * One shared, calm line for the wallet and savings screens while PiggyVest is
 * answering slowly. Renders nothing the rest of the time.
 */
export function PiggyvestSlowdownNotice() {
  const slow = usePiggyvestSlowdown();
  if (!slow) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.notice}
    >
      <View style={styles.icon}>
        <Ionicons name="time-outline" size={16} color={BRAND.primary} />
      </View>
      <Text style={styles.text}>{PIGGYVEST_SLOWDOWN_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: palette.red[50],
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    color: palette.gray[900],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});
