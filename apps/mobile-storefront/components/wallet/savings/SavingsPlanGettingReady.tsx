import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, palette } from '@/constants/Colors';

type Props = {
  colors: (typeof Colors)['light'];
  /** Set once setup has taken longer than the first minute. */
  slow?: boolean;
  /** Automatic checks have stopped: say so, and point to Check now. */
  paused?: boolean;
  onCheckNow?: () => void;
};

/**
 * Shown while a new plan's savings wallet is being set up. Calm and short:
 * nothing is wrong, nothing is needed from the customer, and they can leave.
 * Checks keep running in the background for as long as the wallet is open.
 */
export function SavingsPlanGettingReady({
  colors,
  slow,
  paused,
  onCheckNow,
}: Props) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.card, { borderColor: colors.border }]}
    >
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="hourglass-outline" size={18} color={BRAND.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Getting your plan ready
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {paused
              ? 'This is taking much longer than usual. Tap Check now to see if it’s ready, or come back later.'
              : slow
                ? // The shared slowdown notice above says why; don't repeat it.
                  'This is taking longer than usual. We’ll keep going, and there’s nothing you need to do.'
                : 'This usually takes about a minute. You can leave this screen. We’ll keep going.'}
          </Text>
        </View>
      </View>
      {slow && onCheckNow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check now"
          onPress={onCheckNow}
          style={styles.action}
        >
          <Text style={styles.actionText}>Check now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: BRAND.primary, fontSize: 13, fontWeight: '600' },
});
