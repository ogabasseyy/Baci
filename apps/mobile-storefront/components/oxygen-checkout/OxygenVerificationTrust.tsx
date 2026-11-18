import { Image, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';
import { useOxygenColors } from './OxygenFormPrimitives';

/** Same official logo and reassurance copy as the web application. */
export function OxygenVerificationTrust() {
  const colors = useOxygenColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.logoFrame, { backgroundColor: Colors.light.background }]}
      >
        <Image
          source={require('../../assets/images/oxygen-x.png')}
          accessibilityLabel="Oxygen X Finance Company"
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>
          Identity verification by Oxygen X
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          A subsidiary of Access Holdings, Access Bank’s parent company.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderRadius: 16,
  },
  logoFrame: { padding: 6, borderRadius: 8 },
  logo: { width: 68, height: 38 },
  copy: { flex: 1, gap: 5 },
  title: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  description: { fontSize: 12, lineHeight: 18 },
});
