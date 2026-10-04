import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SavingsProviderPreview } from '../SavingsProviderPreview';

/** Decorative artwork stays local so the setup loads without image requests. */
export function SavingsSetupHero() {
  return (
    <View style={styles.hero}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={13} color="#302047" />
          <Text style={styles.badgeText}>BIG UPGRADE ENERGY</Text>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.spark}
        >
          <Ionicons name="sparkles" size={26} color="#302047" />
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
            <Ionicons name="heart" size={30} color="#C93438" />
            <Text style={styles.phoneText}>next up</Text>
          </View>
          <View style={styles.coin}>
            <Ionicons name="add" size={25} color="#283316" />
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        <Ionicons name="trending-up" size={16} color="#302047" />
        <Text style={styles.footerText}>
          Small steps. Main character upgrade.
        </Text>
      </View>
      <SavingsProviderPreview />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: '#E2D3FF',
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
    backgroundColor: '#F4EDFF',
    borderRadius: 30,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#302047',
  },
  spark: { transform: [{ rotate: '12deg' }] },
  body: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1 },
  title: {
    fontSize: 34,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -1.4,
    color: '#302047',
  },
  subtitle: { marginTop: 12, fontSize: 14, lineHeight: 21, color: '#514064' },
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
    backgroundColor: '#CBB4F1',
  },
  phone: {
    width: 70,
    height: 115,
    borderRadius: 18,
    borderWidth: 4,
    borderColor: '#302047',
    backgroundColor: '#FFF4E6',
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
    backgroundColor: '#302047',
  },
  phoneText: { color: '#302047', fontSize: 10, fontWeight: '800' },
  coin: {
    position: 'absolute',
    bottom: 0,
    left: -6,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D6F588',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#E2D3FF',
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#C7B4E2',
    paddingTop: 14,
  },
  footerText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#302047' },
});
