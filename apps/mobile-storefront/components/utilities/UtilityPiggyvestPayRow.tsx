import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';

/** The wallet screen's own name for the PiggyVest wallet. */
export const SAVINGS_WALLET_LABEL = 'Savings wallet · NGN';

/**
 * The PiggyVest savings wallet row, shown only while paying from PiggyVest is
 * switched on for this customer: selected when it pays this purchase (it
 * covers the amount and store credit doesn't), its balance before an amount
 * is chosen, or the real shortfall when the amount is more than it holds.
 */
export function UtilityPiggyvestPayRow({
  balanceKobo,
  colors,
  mode = 'pays',
  amount = 0,
}: {
  /** Null only for 'resumes' (no live balance during a rollback). */
  balanceKobo: number | null;
  colors: (typeof Colors)['light'];
  /** 'resumes': an earlier payment from it is being finished. */
  mode?: 'pays' | 'available' | 'short' | 'resumes';
  /** The purchase amount in naira (for the shortfall). */
  amount?: number;
}) {
  const balance = (balanceKobo ?? 0) / 100;
  const available = `₦${balance.toLocaleString()} available`;
  const meta =
    mode === 'resumes'
      ? 'Finishing your earlier payment'
      : mode === 'pays'
        ? `${available} · covers this purchase`
        : mode === 'short'
          ? `${available} · ₦${Math.max(amount - balance, 0).toLocaleString()} more needed`
          : available;
  const selected = mode === 'pays' || mode === 'resumes';
  return (
    <View
      style={[
        styles.row,
        selected
          ? {
              backgroundColor: `${BRAND.primary}12`,
              borderColor: BRAND.primary,
            }
          : { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${SAVINGS_WALLET_LABEL}. ${meta}`}
    >
      <View style={[styles.icon, { backgroundColor: `${BRAND.primary}15` }]}>
        <Ionicons name="wallet-outline" size={18} color={BRAND.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>
          {SAVINGS_WALLET_LABEL}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {meta}
        </Text>
      </View>
      <View
        style={[
          styles.radioOuter,
          { borderColor: selected ? BRAND.primary : colors.border },
        ]}
      >
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, gap: 4 },
  icon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  meta: { fontSize: 13 },
  radioInner: {
    backgroundColor: BRAND.primary,
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  radioOuter: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  row: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: SPACING.md,
  },
  title: { fontSize: 15, fontWeight: '600' },
});
