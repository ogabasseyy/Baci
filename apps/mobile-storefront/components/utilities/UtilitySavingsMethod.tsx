import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { UtilityPiggyvestPayRow } from './UtilityPiggyvestPayRow';

/**
 * The payment section when the savings wallet is the only method shown: it
 * pays this purchase, holds a balance before an amount is chosen, or resumes
 * an earlier payment (Codex P2).
 */
export function UtilitySavingsMethod(props: {
  colors: (typeof Colors)['light'];
  balanceKobo: number | null;
  mode: 'pays' | 'available' | 'resumes';
}) {
  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: props.colors.text }]}>
        Payment Method
      </Text>
      <UtilityPiggyvestPayRow {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: SPACING.lg },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
});
