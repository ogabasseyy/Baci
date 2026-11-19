import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

interface FeedbackSubmitButtonProps {
  isSending: boolean;
  onPress: () => void;
}

export function FeedbackSubmitButton({
  isSending,
  onPress,
}: FeedbackSubmitButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        styles.submitButton,
        { backgroundColor: colors.primary, opacity: isSending ? 0.7 : 1 },
      ]}
      onPress={onPress}
      disabled={isSending}
    >
      {isSending ? (
        <ActivityIndicator color={colors.textOnPrimary} />
      ) : (
        <>
          <Ionicons name="paper-plane" size={20} color={colors.textOnPrimary} />
          <Text
            style={[styles.submitButtonText, { color: colors.textOnPrimary }]}
          >
            Submit Feedback
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  submitButtonText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
});
