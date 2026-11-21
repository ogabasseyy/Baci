import { ActivityIndicator, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { oxygenPresentation as styles } from './oxygen-presentation';

const labels = {
  bvn: 'Checking your BVN',
  status: 'Checking verification status',
  eligibility: 'Checking your payment options',
  nin: 'Validating your NIN',
};
export function OxygenVerificationProgress({
  operation,
  title,
}: {
  operation: keyof typeof labels;
  title?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.title, { color: colors.text }]}>
        {title ?? labels[operation]}
      </Text>
      <Text style={{ color: colors.text }}>
        Your progress is saved while Oxygen confirms this step.
      </Text>
    </View>
  );
}
