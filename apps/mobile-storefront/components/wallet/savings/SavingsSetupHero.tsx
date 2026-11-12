import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';

// Brand palette: soft red tint, dark text, red accents.
const INK = palette.gray[900];

/** Decorative artwork stays local so the setup loads without image requests. */
export function SavingsSetupHero() {
  return (
    <View style={styles.hero}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={13} color={BRAND.primary} />
          <Text style={styles.badgeText}>Big upgrade energy</Text>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.spark}
        >
          <Ionicons name="sparkles" size={26} color={BRAND.primary} />
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            Dream it.{'\n'}Save for it.
          </Text>
          <Text style={styles.subtitle}>
            Your next device, one little win at a time.
          </Text>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.art}
        >
          <View style={styles.orbit} />
          <View style={styles.phone}>
            <View style={styles.notch} />
            <Ionicons name="heart" size={30} color={BRAND.primary} />
            <Text style={styles.phoneText}>next up</Text>
          </View>
          <View style={styles.coin}>
            <Ionicons name="add" size={25} color={palette.white} />
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        <Ionicons name="trending-up" size={16} color={BRAND.primary} />
        <Text style={styles.footerText}>
          Small steps. Main character upgrade.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: palette.red[50],
    borderRadius: 28,
    padding: 22,
    gap: 20,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.white,
    borderRadius: 30,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: INK },
  spark: { transform: [{ rotate: '12deg' }] },
  body: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1 },
  title: {
    fontSize: 31,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -1.4,
    color: INK,
  },
  subtitle: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 21,
    color: palette.gray[600],
  },
  art: {
    width: 92,
    height: 136,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: palette.red[100],
  },
  phone: {
    width: 70,
    height: 115,
    borderRadius: 18,
    borderWidth: 4,
    borderColor: INK,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    transform: [{ rotate: '12deg' }],
  },
  notch: {
    position: 'absolute',
    top: 5,
    width: 25,
    height: 5,
    borderRadius: 8,
    backgroundColor: INK,
  },
  phoneText: { color: INK, fontSize: 9, fontWeight: '800' },
  coin: {
    position: 'absolute',
    bottom: 0,
    left: -6,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: palette.red[50],
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.red[200],
    paddingTop: 14,
  },
  footerText: { flex: 1, fontSize: 11, fontWeight: '600', color: INK },
});
