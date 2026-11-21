import Ionicons from '@react-native-vector-icons/ionicons';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { withAlpha } from '@/constants/Colors';
import { OxygenActionFooter } from './OxygenActionFooter';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';
import { OxygenPlanAmount } from './OxygenPlanAmount';
import { OxygenPlanSlider } from './OxygenPlanSlider';
import { type OxygenPlanLimits, validOxygenPlan } from './oxygen-plan';
import { oxygenPlanDisplay } from './oxygen-plan-display';

export function OxygenPlanStep({
  limits,
  equityPercentage,
  tenure,
  busy = false,
  onEquityChange,
  onTenureChange,
  onBook,
}: {
  limits: OxygenPlanLimits;
  equityPercentage: number;
  tenure: number;
  busy?: boolean;
  onEquityChange: (value: number) => void;
  onTenureChange: (value: number) => void;
  onBook: (command: {
    action: 'book';
    equityPercentage: number;
    tenure: number;
  }) => void;
}) {
  const colors = useOxygenColors();
  const valid = validOxygenPlan(limits, equityPercentage, tenure);
  const { exceedsOffer, unavailable, months, min, max, tenures } =
    oxygenPlanDisplay(limits, equityPercentage, tenure);
  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <Ionicons name="options-outline" size={19} color={colors.primary} />
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.primary }]}
          >
            Choose your down payment
          </Text>
        </View>
        <View
          style={[
            styles.eligible,
            { backgroundColor: withAlpha(colors.success, 0.1) },
          ]}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={19}
            color={colors.success}
          />
          <Text style={[styles.eligibleText, { color: colors.textSecondary }]}>
            You’re eligible to spread your payment for up to{' '}
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {months} {months === 1 ? 'month' : 'months'}
            </Text>
            .
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <OxygenPlanAmount
          amount={(limits.productAmount * equityPercentage) / 100}
          percentage={equityPercentage}
          disabled={busy}
          onChange={(amount) =>
            onEquityChange(
              Number.isFinite(amount)
                ? Math.round((amount / limits.productAmount) * 10000) / 100
                : Number.NaN
            )
          }
        />
        <OxygenPlanSlider
          value={equityPercentage}
          min={min}
          max={max}
          total={limits.productAmount}
          disabled={busy || unavailable}
          onChange={(value) => {
            if (validOxygenPlan(limits, value, tenure)) onEquityChange(value);
          }}
        />
        <View style={styles.presets}>
          {[25, 50, 75, 90].map((value) => {
            const allowed = validOxygenPlan(limits, value, tenure);
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${value}%`}
                accessibilityState={{
                  selected: equityPercentage === value,
                  disabled: busy || !allowed,
                }}
                disabled={busy || !allowed}
                onPress={() => {
                  Keyboard.dismiss();
                  onEquityChange(value);
                }}
                style={[
                  styles.preset,
                  {
                    backgroundColor:
                      equityPercentage === value
                        ? colors.primaryLowOpacity
                        : colors.background,
                    borderColor:
                      equityPercentage === value
                        ? colors.primary
                        : colors.border,
                    opacity: allowed ? 1 : 0.4,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    {
                      color:
                        equityPercentage >= value - 2
                          ? colors.primary
                          : colors.text,
                    },
                  ]}
                >
                  {value}%
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={[styles.label, { color: colors.text }]}>
          Repayment period
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.terms}
        >
          {tenures.map((month) => (
            <Pressable
              key={month}
              accessibilityRole="button"
              accessibilityLabel={`${month} ${month === 1 ? 'month' : 'months'}`}
              accessibilityState={{
                selected: tenure === month,
                disabled: busy,
              }}
              disabled={busy}
              onPress={() => onTenureChange(month)}
              style={[
                styles.term,
                {
                  backgroundColor:
                    tenure === month ? colors.primaryLowOpacity : colors.card,
                  borderColor:
                    tenure === month ? colors.primary : colors.border,
                  borderWidth: tenure === month ? 1.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  { color: tenure === month ? colors.primary : colors.text },
                ]}
              >
                {month} {month === 1 ? 'month' : 'months'}
              </Text>
              {tenure === month ? (
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={colors.primary}
                />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {!valid ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {unavailable
            ? 'This repayment period is not available for this order.'
            : exceedsOffer
              ? 'Increase your down payment or choose another repayment period to stay within your approved limit.'
              : 'Choose a down payment and repayment period within your approved limits.'}
        </Text>
      ) : null}
      <OxygenActionFooter>
        <OxygenButton
          title={busy ? 'Preparing your breakdown…' : 'See payment breakdown'}
          loading={busy}
          disabled={!valid}
          onPress={() =>
            onBook({
              action: 'book',
              equityPercentage: equityPercentage,
              tenure,
            })
          }
        />
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          See your full costs before you accept.
        </Text>
      </OxygenActionFooter>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { gap: 24 },
  heading: { gap: 13 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  eligible: {
    borderRadius: 14,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  eligibleText: { flex: 1, fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 15 },
  presets: { flexDirection: 'row', gap: 9, marginTop: 4 },
  preset: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 14, fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '600' },
  terms: { gap: 10, paddingBottom: 2 },
  term: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
