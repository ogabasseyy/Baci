import { StyleSheet, Text, View } from 'react-native';
import { PiggyVestLogo } from './PiggyVestLogo';

/** Local design preview. Live attribution still follows the actual provider. */
export function SavingsProviderPreview() {
  if (!__DEV__) return null;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel="Savings powered by PiggyVest. Design preview."
        style={styles.badge}
      >
        <Text style={styles.label}>Powered by</Text>
        <PiggyVestLogo width={76} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
  },
  label: { color: '#525252', fontSize: 9, lineHeight: 15 },
});
