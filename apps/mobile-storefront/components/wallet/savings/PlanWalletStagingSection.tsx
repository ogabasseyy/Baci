import { Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { formatKoboToNaira } from '@/lib/format-kobo-to-naira';
import {
  applicablePriceKobo,
  isReady,
  purchasingPowerKobo,
} from '@/lib/piggyvest/savings-policy';
import { PlanWalletStagingPreviewRow } from './PlanWalletStagingPreviewRow';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

type PlanWalletStagingSectionProps = {
  colors: StartSavingsColors;
  /** Target price in kobo (converted from the form's naira target). */
  targetKobo: number;
};

/**
 * Staging-only plan-wallet preview, rendered inside the existing Start
 * Savings form in dev builds. Synthetic reconciled figures; no provider
 * calls, no real money, no effect on the Paystack flow. Returns null in
 * production builds.
 */
const SYNTHETIC_PRINCIPAL_KOBO = 9_500_000;
const SYNTHETIC_PAID_INTEREST_KOBO = 300_000;
const SYNTHETIC_PENDING_ACCRUAL_KOBO = 200_000;

export function PlanWalletStagingSection({
  colors,
  targetKobo,
}: PlanWalletStagingSectionProps) {
  if (!__DEV__) {
    return null;
  }

  if (!Number.isSafeInteger(targetKobo) || targetKobo <= 0) {
    return (
      <View
        accessibilityLabel="Plan wallet staging preview"
        style={[
          styles.sourceModeCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.text }]}>
          Plan wallet (staging preview)
        </Text>
        <Text style={[styles.sourceModeHint, { color: colors.textSecondary }]}>
          Select a device to price this synthetic preview. No real money moves
          here.
        </Text>
      </View>
    );
  }

  const price = applicablePriceKobo({
    guaranteedPriceKobo: targetKobo,
    currentPriceKobo: targetKobo,
  });
  const power = purchasingPowerKobo(
    SYNTHETIC_PRINCIPAL_KOBO,
    SYNTHETIC_PAID_INTEREST_KOBO
  );
  const ready = isReady(power, price);
  const progress = Math.min(1, power / price);

  return (
    <View
      accessibilityLabel="Plan wallet staging preview"
      style={[
        styles.sourceModeCard,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Plan wallet (staging preview)
      </Text>
      <Text style={[styles.sourceModeHint, { color: colors.textSecondary }]}>
        Synthetic reconciled figures for design review only. No real money moves
        here.
      </Text>

      <View style={{ marginTop: 8, gap: 2 }}>
        <PlanWalletStagingPreviewRow
          colors={colors}
          label="Funding account"
          value="9000 000 001 · Synthetic Bank"
        />
        <PlanWalletStagingPreviewRow
          colors={colors}
          label="Purchasing power"
          value={formatKoboToNaira(power)}
        />
        <PlanWalletStagingPreviewRow
          colors={colors}
          label="Pending accrual (not spendable)"
          value={formatKoboToNaira(SYNTHETIC_PENDING_ACCRUAL_KOBO)}
        />
        <PlanWalletStagingPreviewRow
          colors={colors}
          label="Cancel quote: principal refund"
          value={formatKoboToNaira(SYNTHETIC_PRINCIPAL_KOBO)}
        />
        <PlanWalletStagingPreviewRow
          colors={colors}
          label="Cancel quote: interest forfeited"
          value={formatKoboToNaira(
            SYNTHETIC_PAID_INTEREST_KOBO + SYNTHETIC_PENDING_ACCRUAL_KOBO
          )}
        />
      </View>

      <View
        accessibilityLabel={`Savings progress ${Math.round(progress * 100)} percent`}
        style={{
          height: 8,
          borderRadius: 99,
          backgroundColor: colors.border,
          overflow: 'hidden',
          marginTop: 12,
        }}
      >
        <View
          style={{
            height: 8,
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: BRAND.primary,
            borderRadius: 99,
          }}
        />
      </View>
      <Text
        style={[
          styles.sourceModeHint,
          {
            color: ready ? BRAND.primary : colors.textSecondary,
            marginTop: 6,
          },
        ]}
      >
        {ready
          ? 'Ready — covers the target. Review & buy only, never auto-order.'
          : 'Continue saving — progress reflects confirmed funds only.'}
      </Text>
    </View>
  );
}
