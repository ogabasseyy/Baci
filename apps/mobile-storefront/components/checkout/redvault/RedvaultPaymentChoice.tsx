import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY, withAlpha } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';

export interface RedvaultPaymentSummary {
  eligible: boolean;
  mixedBasket: boolean;
  productSubtotalKobo: number;
  eligibleSubtotalKobo: number;
  ineligibleSubtotalKobo?: number;
  discountKobo: number;
  taxAmountKobo: number;
  shippingFeeKobo: number;
  giftWrappingFeeKobo: number;
  payableTotalKobo: number;
}

type RedvaultPaymentStatus = 'idle' | 'pending' | 'held' | 'error';

interface RedvaultPaymentChoiceProps {
  available: boolean;
  selected: boolean;
  status: RedvaultPaymentStatus;
  summary?: RedvaultPaymentSummary;
  onSelect: () => void;
}

function formatKobo(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getStatusMessage(status: RedvaultPaymentStatus) {
  if (status === 'pending') {
    return 'Your UBA payment is being confirmed.';
  }

  if (status === 'held') {
    return 'Your payment has been received and is awaiting verification. Do not pay again.';
  }

  if (status === 'error') {
    return 'We could not start your UBA payment. Choose another method or try again.';
  }

  return null;
}

export function RedvaultPaymentChoice({
  available,
  selected,
  status,
  summary,
  onSelect,
}: RedvaultPaymentChoiceProps) {
  const { colors } = useTheme();

  if (!available) {
    return null;
  }

  const isSelectable =
    (summary?.eligible ?? true) && status !== 'pending' && status !== 'held';
  const statusMessage = getStatusMessage(status);

  return (
    <View
      accessibilityLabel="Pay with UBA offer"
      accessibilityRole="summary"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Pressable
        accessibilityLabel="Pay with UBA"
        accessibilityRole="radio"
        accessibilityState={{
          checked: selected,
          disabled: !isSelectable,
        }}
        disabled={!isSelectable}
        onPress={onSelect}
        style={styles.choice}
      >
        <View style={styles.choiceContent}>
          <Text style={[styles.title, { color: colors.text }]}>
            Pay with UBA
          </Text>
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            10% off when the eligible pre-discount subtotal is below ₦200,000;
            5% at ₦200,000 or more. Excluded products and fees do not count
            toward this threshold.
          </Text>
        </View>
        <View
          style={[
            styles.radio,
            {
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : colors.card,
            },
          ]}
        >
          {selected ? (
            <View style={[styles.radioDot, { backgroundColor: colors.card }]} />
          ) : null}
        </View>
      </Pressable>

      {summary?.mixedBasket ? (
        <Text style={[styles.notice, { color: colors.textSecondary }]}>
          Only eligible items receive the REDVAULT discount. Other basket items
          keep their regular price.
        </Text>
      ) : null}

      {summary && !summary.eligible ? (
        <Text
          accessibilityRole="alert"
          style={[styles.notice, { color: colors.error }]}
        >
          This basket has no items eligible for the UBA REDVAULT discount.
        </Text>
      ) : null}

      {statusMessage ? (
        <Text
          accessibilityRole={
            status === 'error' || status === 'held' ? 'alert' : 'text'
          }
          style={[
            styles.notice,
            {
              color:
                status === 'error' || status === 'held'
                  ? colors.error
                  : colors.textSecondary,
              backgroundColor:
                status === 'error' || status === 'held'
                  ? withAlpha(colors.error, 0.1)
                  : withAlpha(colors.primary, 0.08),
            },
          ]}
        >
          {statusMessage}
        </Text>
      ) : null}

      {summary ? (
        <View accessibilityLabel="UBA payment summary" style={styles.summary}>
          <SummaryRow
            label="Products"
            value={formatKobo(summary.productSubtotalKobo)}
            colors={colors}
          />
          <SummaryRow
            label="Eligible items"
            value={formatKobo(summary.eligibleSubtotalKobo)}
            colors={colors}
          />
          {summary.ineligibleSubtotalKobo !== undefined ? (
            <SummaryRow
              label="Other items"
              value={formatKobo(summary.ineligibleSubtotalKobo)}
              colors={colors}
            />
          ) : null}
          <SummaryRow
            label="UBA discount"
            value={`-${formatKobo(summary.discountKobo)}`}
            colors={colors}
          />
          <SummaryRow
            label="Tax"
            value={formatKobo(summary.taxAmountKobo)}
            colors={colors}
          />
          <SummaryRow
            label="Shipping"
            value={formatKobo(summary.shippingFeeKobo)}
            colors={colors}
          />
          <SummaryRow
            label="Gift wrapping"
            value={formatKobo(summary.giftWrappingFeeKobo)}
            colors={colors}
          />
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>
              Total payable
            </Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>
              {formatKobo(summary.payableTotalKobo)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

interface SummaryRowProps {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}

function SummaryRow({ label, value, colors }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    gap: SPACING.md,
    padding: SPACING.md,
  },
  choice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'space-between',
  },
  choiceContent: { flex: 1, gap: SPACING.xs },
  title: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold },
  caption: {
    fontSize: TYPOGRAPHY.size.base,
    lineHeight: TYPOGRAPHY.size.base * TYPOGRAPHY.lineHeight.normal,
  },
  radio: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  radioDot: { borderRadius: RADIUS.full, height: 8, width: 8 },
  notice: {
    borderRadius: RADIUS.md,
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: TYPOGRAPHY.size.sm * TYPOGRAPHY.lineHeight.normal,
    padding: SPACING.sm,
  },
  summary: { gap: SPACING.sm },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  summaryLabel: { flex: 1, fontSize: TYPOGRAPHY.size.base },
  summaryValue: {
    fontSize: TYPOGRAPHY.size.base,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
  },
  totalLabel: {
    fontSize: TYPOGRAPHY.size.lg,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  totalValue: {
    fontSize: TYPOGRAPHY.size.lg,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
});
