import { StyleSheet, Text, View } from 'react-native';
import { PiggyVestLogo } from './PiggyVestLogo';

/** Local design preview. Live attribution still follows the actual provider. */
export function SavingsProviderPreview({
  subtle = false,
}: {
  subtle?: boolean;
}) {
  if (!__DEV__) return null;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel="Savings powered by PiggyVest. Design preview."
        style={[styles.badge, subtle && styles.subtleBadge]}
      >
        <Text style={[styles.label, subtle && styles.subtleLabel]}>
          Powered by
        </Text>
        <PiggyVestLogo
          width={subtle ? 48 : 62}
          color={subtle ? '#f7dedf' : undefined}
        />
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
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F5F5F5',
  },
  subtleBadge: {
    backgroundColor: 'rgba(25, 10, 17, 0.68)',
    borderRadius: 6,
    paddingVertical: 3,
  },
  subtleLabel: { color: '#f7dedf' },
  label: { color: '#525252', fontSize: 8, lineHeight: 12 },
});
