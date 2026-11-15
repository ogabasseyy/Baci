import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { IMEI_CARE } from './imei-care-look';
import type { ImeiCheckerColors } from './imei-check.types';

const IMEI_TRUST_INDICATORS = [
  '15-digit check',
  'Official status',
  'Instant report',
] as const;

/**
 * The checker's hero, in the burgundy device-care style of the refreshed
 * home: what the page does in one line, and three quiet promises.
 */
export default function HeroCard(_props: { colors: ImeiCheckerColors }) {
  return (
    <View style={styles.hero}>
      <View style={styles.titleRow}>
        <Ionicons
          name="barcode-outline"
          size={24}
          color={IMEI_CARE.heroAccent}
        />
        <Text accessibilityRole="header" style={styles.title}>
          Device verification
        </Text>
      </View>
      <View style={styles.chips}>
        {IMEI_TRUST_INDICATORS.map((item) => (
          <View key={item} style={styles.chip}>
            <Ionicons name="checkmark" size={12} color={IMEI_CARE.heroAccent} />
            <Text style={styles.chipText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: IMEI_CARE.hero,
    borderRadius: 20,
    gap: 10,
    marginBottom: SPACING.sm,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { color: IMEI_CARE.heroText, fontSize: 20, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: {
    alignItems: 'center',
    backgroundColor: IMEI_CARE.heroChip,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    color: IMEI_CARE.heroBody,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
});
