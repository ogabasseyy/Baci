import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { BRAND, palette } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { daysUntil, localDay } from '../get-savings-pace';
import { SavingsProductThumb } from './SavingsProductThumb';
import { EARLY_CANCEL_INTEREST_NOTE } from './savings-interest-copy';
import { savingsPaceWords } from './savings-pace-words';
import { savingsProductImage } from './savings-product-image';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = { colors: StartSavingsColors; controller: StartSavingsController };
type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The plan at a glance on the review sheet: the phone on a red-tinted card,
 * the pace as the headline, a start-to-finish timeline, and how it works.
 */
export function StartSavingsReviewPlan({ colors, controller }: Props) {
  const product = controller.selectedProduct;
  // Counted from today to the plan's end date, so a later start is included.
  const daysToGo = daysUntil(controller.maturityDate, new Date());
  const auto = controller.sourceMode === 'auto_debit';
  // A head start that covers the whole price completes the plan today, so
  // the timeline runs today to today (never a later start before its end).
  const completeToday = headStartShare(controller) === 'all';
  const today = localDay(new Date());
  const startDate = completeToday ? today : controller.startDate;
  const phoneDate = completeToday ? today : controller.maturityDate;
  return (
    <View style={styles.wrap}>
      <View style={styles.phoneCard}>
        <SavingsProductThumb
          uri={savingsProductImage(
            controller.selectedCatalogProduct,
            controller.variantOptionGroups ?? [],
            product?.image ?? ''
          )}
          title={product?.name}
        />
        <View style={styles.phoneCopy}>
          <Text style={styles.phoneName} numberOfLines={2}>
            {product?.name ?? 'Your phone'}
          </Text>
          <Text style={styles.goal}>
            {formatNgnCurrency(controller.targetValue)} goal
          </Text>
        </View>
      </View>
      <View>
        <Text style={[styles.headline, { color: colors.text }]}>
          {formatNgnCurrency(controller.contributionValue)}{' '}
          {savingsPaceWords(controller.frequency)}
        </Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {yoursLine(
            daysToGo,
            controller.maturityDate,
            headStartShare(controller)
          )}
        </Text>
      </View>
      <View accessible accessibilityLabel={timelineLabel(startDate, phoneDate)}>
        <View style={styles.barRow}>
          <Ionicons name="flag-outline" size={16} color={BRAND.primary} />
          <View style={styles.bar}>
            <View style={styles.barFill} />
          </View>
          <Ionicons name="gift-outline" size={16} color={BRAND.primary} />
        </View>
        <View style={styles.barLabels}>
          <DateLabel colors={colors} label="Start" date={startDate} />
          <DateLabel colors={colors} label="Your phone" date={phoneDate} end />
        </View>
      </View>
      <View style={[styles.rows, { borderColor: colors.border }]}>
        <IconRow
          colors={colors}
          icon={auto ? 'card-outline' : 'wallet-outline'}
          text={
            auto
              ? 'Automatically, by card'
              : 'From your wallet, whenever you like'
          }
        />
        {controller.askInterest && controller.interestChoice !== null ? (
          <IconRow
            colors={colors}
            icon={
              controller.interestChoice
                ? 'trending-up-outline'
                : 'shield-checkmark-outline'
            }
            text={controller.interestChoice ? 'Earns interest' : 'Savings only'}
            note={
              controller.interestChoice ? EARLY_CANCEL_INTEREST_NOTE : undefined
            }
          />
        ) : null}
      </View>
    </View>
  );
}

/** How much of the target the head start covers: none, part or all. */
function headStartShare(
  controller: StartSavingsController
): 'none' | 'part' | 'all' {
  // A head start paid later, after the plan exists (by bank transfer, or
  // from the PiggyVest wallet with a PIN), covers none of the target yet,
  // so it is never "Yours today". Only an immediate legacy-wallet debit at
  // creation counts.
  const headStart =
    controller.sourceMode === 'auto_debit' ||
    controller.selectedFundingOption === 'bank_transfer' ||
    controller.primaryWallet
      ? 0
      : controller.effectiveInitialContribution;
  if (!(headStart > 0)) return 'none';
  return headStart >= controller.targetValue ? 'all' : 'part';
}

/**
 * "Yours today", "Yours in about 124 days", or the date when unknown. The
 * plan's end date is worked out from the full price, so with a partial head
 * start the line says the estimate does not count it (it will likely be sooner).
 */
function yoursLine(
  daysToGo: number | null,
  maturityDate: string,
  headStart: 'none' | 'part' | 'all' = 'none'
) {
  if (headStart === 'all' || daysToGo === 0) return 'Yours today';
  if (headStart === 'part' && daysToGo !== null)
    return `Yours in about ${daysToGo} day${daysToGo === 1 ? '' : 's'}, not counting your head start`;
  if (daysToGo === null)
    return `Yours by ${formatDateTimeDisplay(maturityDate, 'date')}`;
  return `Yours in about ${daysToGo} day${daysToGo === 1 ? '' : 's'}`;
}

function timelineLabel(startDate: string, phoneDate: string) {
  return `From ${formatDateTimeDisplay(startDate, 'date')} to about ${formatDateTimeDisplay(phoneDate, 'date')}`;
}

function DateLabel({
  colors,
  label,
  date,
  end = false,
}: {
  colors: StartSavingsColors;
  label: string;
  date: string;
  end?: boolean;
}) {
  return (
    <View style={end ? styles.labelEnd : null}>
      <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.date, { color: colors.text }]}>
        {formatDateTimeDisplay(date, 'date')}
      </Text>
    </View>
  );
}

function IconRow({
  colors,
  icon,
  text,
  note,
}: {
  colors: StartSavingsColors;
  icon: IconName;
  text: string;
  note?: string;
}) {
  return (
    <View style={styles.iconRow}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={16} color={BRAND.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowText, { color: colors.text }]}>{text}</Text>
        {note ? (
          <Text style={[styles.rowNote, { color: colors.textSecondary }]}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const INK = palette.gray[900];

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  phoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: palette.red[50],
    padding: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: 48, height: 48 },
  phoneCopy: { flex: 1, gap: 2 },
  phoneName: { color: INK, fontSize: 15, fontWeight: '700' },
  goal: { color: palette.gray[600], fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  sub: { fontSize: 14, marginTop: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.red[100],
    overflow: 'hidden',
  },
  barFill: {
    width: '8%',
    height: '100%',
    borderRadius: 3,
    backgroundColor: BRAND.primary,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  labelEnd: { alignItems: 'flex-end' },
  dateLabel: { fontSize: 11 },
  date: { fontSize: 13, fontWeight: '600' },
  rows: { borderTopWidth: 1, paddingTop: 14, gap: 14 },
  iconRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 2, paddingTop: 6 },
  rowText: { fontSize: 14, fontWeight: '600' },
  rowNote: { fontSize: 12, lineHeight: 17 },
});
