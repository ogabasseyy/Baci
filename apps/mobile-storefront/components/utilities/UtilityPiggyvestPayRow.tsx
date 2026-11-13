import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';

/** The wallet screen's own name for the PiggyVest wallet. */
export const SAVINGS_WALLET_LABEL = 'Savings wallet · NGN';

/**
 * The selected payment row when the PiggyVest savings wallet pays this
 * purchase (it covers the amount and store credit doesn't). Shown only while
 * paying from PiggyVest is switched on for this customer.
 */
export function UtilityPiggyvestPayRow({
  balanceKobo,
  colors,
}: {
  balanceKobo: number;
  colors: (typeof Colors)['light'];
}) {
  const available = `₦${(balanceKobo / 100).toLocaleString()} available`;
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: `${BRAND.primary}12`, borderColor: BRAND.primary },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${SAVINGS_WALLET_LABEL}. ${available}. Covers this purchase`}
    >
      <View style={[styles.icon, { backgroundColor: `${BRAND.primary}15` }]}>
        <Ionicons name="wallet-outline" size={18} color={BRAND.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>
          {SAVINGS_WALLET_LABEL}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`${available} · covers this purchase`}
        </Text>
      </View>
      <View style={[styles.radioOuter, { borderColor: BRAND.primary }]}>
        <View style={styles.radioInner} />
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
