import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { palette } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { getWeeklySavingsNudge } from '../get-weekly-savings-nudge';
import { SavingsPhoneThumb } from './SavingsPhoneThumb';
import type { SavingsPhoneRow } from './savings-phone-rows';
import { styles } from './savings-phone-swap.styles';
import { savingsSwapPace } from './savings-swap-pace';

type WalletColors = (typeof Colors)['light'];

function Line({
  colors,
  label,
  value,
  total = false,
}: {
  colors: WalletColors;
  label: string;
  value: string;
  total?: boolean;
}) {
  return (
    <View
      style={[
        styles.line,
        total && [styles.lineTotal, { borderTopColor: colors.border }],
      ]}
    >
      <Text
        style={[
          styles.lineText,
          { color: total ? colors.text : colors.textSecondary },
          total && styles.bold,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[styles.lineText, { color: colors.text }, total && styles.bold]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Step 2 of Change phone: nothing changes until the customer confirms. The
 * savings move over, the goal becomes the new price, and the plan keeps its
 * end date (the server changes only the target), so the new pace is shown.
 */
export function SavingsPhoneSwapConfirm({
  colors,
  goal,
  onConfirm,
  onKeep,
  pending,
  row,
}: {
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  onConfirm: () => void;
  onKeep: () => void;
  pending: boolean;
  row: SavingsPhoneRow;
}) {
  const saved = goal.current_amount;
  const pace = getWeeklySavingsNudge({
    maturityDate: goal.maturity_date,
    remaining: row.price - saved,
  });
  // The ongoing pace is quoted in the plan's own frequency.
  const perPeriod = savingsSwapPace({
    frequency: goal.contribution_frequency,
    maturityDate: goal.maturity_date,
    remaining: row.price - saved,
  });
  return (
    <View style={styles.root}>
      <Text
        accessibilityRole="header"
        style={[styles.confirmTitle, { color: colors.text }]}
      >
        {`Switch to ${row.title}?`}
      </Text>
      {row.meta.length > 0 ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {row.meta.join(' · ')}
        </Text>
      ) : null}
      <View style={styles.swapIcons}>
        <SavingsPhoneThumb
          background={colors.muted}
          iconColor={colors.textSecondary}
          image={goal.product_image}
          title={goal.title}
        />
        <Ionicons name="arrow-forward" size={20} color={colors.primary} />
        <SavingsPhoneThumb
          background={palette.red[50]}
          iconColor={colors.primary}
          image={row.image}
          title={row.title}
        />
      </View>
      <View style={[styles.card, { borderColor: colors.border }]}>
        <Line
          colors={colors}
          label="Your savings move over"
          value={formatNgnCurrency(saved)}
        />
        <Line
          colors={colors}
          label="New goal"
          value={formatNgnCurrency(row.price)}
        />
        {pace ? (
          <Line
            colors={colors}
            label={
              pace.due ? `Due by ${pace.endsOn}` : `To finish by ${pace.endsOn}`
            }
            value={
              pace.due
                ? formatNgnCurrency(pace.amountPerWeek)
                : perPeriod
                  ? `${formatNgnCurrency(perPeriod.amount)} ${perPeriod.unit}`
                  : `${formatNgnCurrency(pace.amountPerWeek)} a week`
            }
            total
          />
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch phone"
        accessibilityState={{ disabled: pending, busy: pending }}
        disabled={pending}
        onPress={onConfirm}
        style={[styles.primary, { backgroundColor: colors.primary }]}
      >
        {pending ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Text
            style={[styles.primaryText, { color: colors.primaryForeground }]}
          >
            Switch phone
          </Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Keep ${goal.title}`}
        disabled={pending}
        onPress={onKeep}
        style={styles.secondary}
      >
        <Text style={[styles.secondaryText, { color: colors.text }]}>
          {`Keep ${goal.title}`}
        </Text>
      </Pressable>
    </View>
  );
}
