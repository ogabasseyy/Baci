import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getSavingsProgress } from '../get-savings-progress';

export function SavingsPlanListCard({
  goal,
  colors,
  onPress,
}: {
  goal: WalletActiveSavingsGoal;
  colors: (typeof Colors)['light'];
  onPress: () => void;
}) {
  const { percent: percentage, percentLabel: progressLabel } =
    getSavingsProgress(goal);
  const status =
    goal.status === 'active'
      ? 'Active'
      : goal.status === 'paused'
        ? 'Paused'
        : 'Completed';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${goal.title}`}
      accessibilityHint="Open this savings plan"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.image, { backgroundColor: colors.muted }]}>
          {goal.product_image ? (
            <Image
              source={{ uri: goal.product_image }}
              style={styles.image}
              resizeMode="contain"
              accessible={false}
            />
          ) : (
            <Text style={[styles.monogram, { color: BRAND.primary }]}>
              {goal.title.slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.details}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {goal.title}
          </Text>
          <Text
            style={[
              styles.status,
              {
                color:
                  goal.status === 'active'
                    ? BRAND.primary
                    : colors.textSecondary,
              },
            ]}
          >
            {status}
          </Text>
        </View>
        <Text style={[styles.arrow, { color: colors.textSecondary }]}>›</Text>
      </View>
      <View style={styles.amountRow}>
        <View style={styles.details}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            SAVED
          </Text>
          <Text style={[styles.amount, { color: colors.text }]}>
            {formatNgnCurrency(goal.current_amount)}
          </Text>
        </View>
        <View style={styles.target}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            TARGET
          </Text>
          <Text style={[styles.targetAmount, { color: colors.textSecondary }]}>
            {formatNgnCurrency(goal.target_amount)}
          </Text>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${goal.title} progress`}
        accessibilityValue={{
          min: 0,
          max: 100,
          now: percentage,
          text: progressLabel,
        }}
        style={[styles.track, { backgroundColor: colors.muted }]}
      >
        <View
          style={{
            height: 6,
            width: `${percentage}%`,
            backgroundColor: BRAND.primary,
          }}
        />
      </View>
      <View style={styles.footer}>
        <Text style={[styles.remaining, { color: colors.textSecondary }]}>
          {formatNgnCurrency(
            Math.max(0, goal.target_amount - goal.current_amount)
          )}{' '}
          to go
        </Text>
        <Text style={[styles.progress, { color: BRAND.primary }]}>
          {progressLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  image: {
    width: 58,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogram: { fontSize: 26, fontWeight: '800' },
  details: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
  status: { fontSize: 12, fontWeight: '600', marginTop: 5 },
  arrow: { fontSize: 28 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    marginBottom: 5,
  },
  amount: { fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] },
  target: { alignItems: 'flex-end' },
  targetAmount: { fontSize: 14, fontWeight: '600' },
  track: { height: 6, borderRadius: 6, overflow: 'hidden' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  remaining: { fontSize: 12, flex: 1 },
  progress: { fontSize: 12, fontWeight: '700' },
});
