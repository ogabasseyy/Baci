import { StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';
import { PiggyVestLogo } from './PiggyVestLogo';

/** The funding-account response, not a UI flag, determines attribution. */
export function WalletProviderAttribution({
  provider,
  color,
}: {
  provider: string;
  color: string;
}) {
  if (provider.trim().toLowerCase() !== 'piggyvest') return null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Powered by PiggyVest"
      style={styles.attribution}
    >
      <Text style={[styles.label, { color }]}>Powered by</Text>
      <View style={styles.logoPlate}>
        <PiggyVestLogo width={88} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  label: { fontSize: 11, lineHeight: 16 },
  logoPlate: {
    backgroundColor: palette.gray[50],
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
});
