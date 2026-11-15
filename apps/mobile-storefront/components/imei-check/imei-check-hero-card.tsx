import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING } from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';

const IMEI_TRUST_INDICATORS = [
  '15-digit check',
  'Official status',
  'Instant report',
] as const;

/**
 * The checker's top band, in the refreshed home's look: black band, white
 * title, the device stamp tiles (children), and a quiet promise line under
 * them like the home's "Ogabassey Never Disappoints!".
 */
export default function HeroCard({
  colors,
  children,
}: {
  colors: ImeiCheckerColors;
  children?: ReactNode;
}) {
  const dark = colors.background !== colors.white;
  return (
    <View
      style={[
        styles.band,
        { backgroundColor: dark ? '#181416' : colors.black },
      ]}
    >
      <View style={styles.titleRow}>
        <Ionicons name="barcode-outline" size={20} color="#ffc1c3" />
        <Text accessibilityRole="header" style={styles.title}>
          Device verification
        </Text>
      </View>
      {children}
      <View style={styles.promise}>
        {IMEI_TRUST_INDICATORS.map((item) => (
          <View key={item} style={styles.promiseItem}>
            <Ionicons
              name="checkmark-circle-outline"
              size={13}
              color="#ffc1c3"
            />
            <Text style={styles.promiseText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    gap: 12,
    marginBottom: SPACING.sm,
    paddingBottom: 14,
    paddingHorizontal: SPACING.md,
    paddingTop: 12,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  promise: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  promiseItem: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  promiseText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
