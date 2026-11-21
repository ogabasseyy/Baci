import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

const steps = ['Identity', 'Bank', 'Income'];
const titles = [
  'Let’s get to know you',
  'Verify your bank account',
  'Employment and consent',
];
const descriptions = [
  'Enter your details as they appear on your identity records.',
  null,
  'Tell us about your income and where you live.',
];

export function OxygenApplicationHeader({ step }: { step: 0 | 1 | 2 }) {
  const colors = useOxygenColors();
  return (
    <View style={[styles.container, step === 0 && styles.compactContainer]}>
      <View
        style={styles.progress}
        accessibilityLabel={`Step ${step + 1} of 3: ${steps[step]}`}
      >
        {steps.map((label, index) => (
          <View key={label} style={styles.step}>
            <View style={styles.stepLabel}>
              <View
                style={[
                  styles.number,
                  {
                    backgroundColor:
                      index <= step ? colors.primary : colors.muted,
                  },
                ]}
              >
                {index < step ? (
                  <Ionicons
                    name="checkmark"
                    size={13}
                    color={colors.primaryForeground}
                  />
                ) : (
                  <Text
                    style={[
                      styles.numberText,
                      {
                        color:
                          index === step
                            ? colors.primaryForeground
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  { color: index <= step ? colors.text : colors.textSecondary },
                ]}
              >
                {label}
              </Text>
            </View>
            <View
              style={[
                styles.track,
                {
                  backgroundColor:
                    index <= step ? colors.primary : colors.muted,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {titles[step]}
        </Text>
        {descriptions[step] ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {descriptions[step]}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 26 },
  compactContainer: { gap: 16 },
  progress: { flexDirection: 'row', gap: 12 },
  step: { flex: 1, gap: 12 },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  number: {
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: 12, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600' },
  track: { height: 3, borderRadius: 2 },
  heading: { gap: 8 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.6 },
  description: { fontSize: 15, lineHeight: 22 },
});
