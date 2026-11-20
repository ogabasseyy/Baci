import {
  formatOxygenPaymentDate,
  formatOxygenRepaymentReceiptDate,
  OXYGEN_REPAYMENT_HISTORY_LIMIT,
  type OxygenOrderPlan,
} from '@baci/shared/schemas/oxygen-order-plan';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { readOxygenOrderPlan } from '@/lib/oxygen-order-plan';

type Props = {
  colors: {
    border: string;
    card: string;
    text: string;
    textSecondary: string;
  };
  orderId: string;
  userId: string;
};

export function OxygenOrderPlanCard({ colors, orderId, userId }: Props) {
  const [result, setResult] = useState<{
    orderId: string;
    userId: string;
    plan?: OxygenOrderPlan | null;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readOxygenOrderPlan(orderId, userId, signal).then(
      (plan) => {
        if (!signal.aborted) setResult({ orderId, userId, plan });
      },
      () => {
        if (!signal.aborted) setResult({ orderId, userId });
      }
    );
    return () => controller.abort();
  }, [orderId, userId]);

  const current =
    result?.orderId === orderId && result.userId === userId ? result : null;
  if (current?.plan === null) return null;
  if (!current?.plan) {
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.textSecondary }}
      >
        {current
          ? 'Your saved payment plan is temporarily unavailable. Reopen this order to try again.'
          : 'Loading payment plan…'}
      </Text>
    );
  }

  const plan = current.plan;
  const titleColor = { color: colors.text };
  const detailColor = { color: colors.textSecondary };
  const borderColor = { borderColor: colors.border };
  return (
    <View style={[styles.card, { backgroundColor: colors.card }, borderColor]}>
      <View style={styles.titleRow}>
        <Ionicons
          accessible={false}
          name="calendar-outline"
          size={20}
          color={colors.text}
        />
        <Text accessibilityRole="header" style={[styles.title, titleColor]}>
          Oxygen payment plan
        </Text>
      </View>
      {plan.activationConfirmed && (
        <Text style={[styles.emphasis, titleColor]}>Payment plan active</Text>
      )}
      <Text style={detailColor}>
        Saved plan · {plan.months} monthly{' '}
        {plan.months === 1 ? 'payment' : 'payments'}
      </Text>
      {plan.upfront !== null && (
        <View style={styles.row}>
          <Text style={[styles.label, detailColor]}>
            Upfront payment{plan.upfrontConfirmed ? ' confirmed' : ''}
          </Text>
          <Text style={[styles.amount, titleColor]}>
            {formatNgnCurrency(plan.upfront)}
          </Text>
        </View>
      )}
      <View style={[styles.schedule, borderColor]}>
        <Text accessibilityRole="header" style={[styles.emphasis, titleColor]}>
          Payment schedule
        </Text>
        {plan.schedule.map(({ period, dueDate, amount }) => (
          <View
            key={period}
            style={[styles.row, styles.instalment, borderColor]}
          >
            <View style={styles.label}>
              <Text style={[styles.emphasis, titleColor]}>
                Instalment {period}
              </Text>
              <Text style={detailColor}>
                {formatOxygenPaymentDate(dueDate)}
              </Text>
            </View>
            <Text style={[styles.amount, titleColor]}>
              {formatNgnCurrency(amount)}
            </Text>
          </View>
        ))}
        {plan.schedule.length === 0 && (
          <Text style={detailColor}>
            Payment dates are currently unavailable for this plan.
          </Text>
        )}
        {plan.scheduleIncomplete && plan.schedule.length > 0 && (
          <Text style={detailColor}>
            Some payment dates are unavailable. Check your Oxygen agreement for
            the full schedule.
          </Text>
        )}
      </View>
      {Boolean(plan.repaymentReceipts?.length) && (
        <View style={[styles.schedule, borderColor]}>
          <Text
            accessibilityRole="header"
            style={[styles.emphasis, titleColor]}
          >
            Repayment updates
          </Text>
          <Text style={detailColor}>
            Shows up to {OXYGEN_REPAYMENT_HISTORY_LIMIT} recent updates from
            Oxygen.
          </Text>
          {plan.repaymentReceipts?.map(({ id, recordedAt }) => (
            <View key={id} style={styles.row}>
              <Text style={[styles.emphasis, titleColor]}>
                Oxygen reported a repayment
              </Text>
              <Text style={detailColor}>
                Recorded {formatOxygenRepaymentReceiptDate(recordedAt)}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Text style={detailColor}>
        Monthly repayment status is not available here yet. Refer to Oxygen’s
        payment confirmation for repayments made.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, gap: 10, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, fontSize: 16, fontWeight: '700' },
  emphasis: { fontWeight: '600' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    columnGap: 12,
    rowGap: 4,
  },
  label: { flexShrink: 1, gap: 2 },
  amount: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  schedule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingTop: 10,
  },
  instalment: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
});
