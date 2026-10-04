import { StyleSheet, Text } from 'react-native';

/** The funding-account response, not a UI flag, determines attribution. */
export function WalletProviderAttribution({
  provider,
  color,
}: {
  provider: string;
  color: string;
}) {
  if (provider.trim().toLowerCase() !== 'piggyvest') return null;

  return <Text style={[styles.label, { color }]}>Powered by PiggyVest</Text>;
}

const styles = StyleSheet.create({
  label: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 12 },
});
