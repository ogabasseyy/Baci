import { StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

/** Static placeholders keep restore waits quiet on lower-powered devices. */
export function OxygenApplicationLoading() {
  const colors = useOxygenColors();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your application"
      accessibilityState={{ busy: true }}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Getting your application ready…
      </Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.placeholders}
      >
        <View style={styles.steps}>
          {[0, 1, 2].map((step) => (
            <View
              key={step}
              style={[styles.step, { backgroundColor: colors.muted }]}
            />
          ))}
        </View>
        <View style={[styles.heading, { backgroundColor: colors.muted }]} />
        {[0, 1, 2].map((field) => (
          <View key={field} style={styles.field}>
            <View style={[styles.caption, { backgroundColor: colors.muted }]} />
            <View style={[styles.input, { backgroundColor: colors.muted }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 24, paddingVertical: 20 },
  label: { fontSize: 15, lineHeight: 22 },
  placeholders: { gap: 28 },
  steps: { flexDirection: 'row', gap: 12 },
  step: { flex: 1, height: 6, borderRadius: 3 },
  heading: { width: '68%', height: 28, borderRadius: 8 },
  field: { gap: 10 },
  caption: { width: '32%', height: 14, borderRadius: 5 },
  input: { height: 52, borderRadius: 14 },
});
