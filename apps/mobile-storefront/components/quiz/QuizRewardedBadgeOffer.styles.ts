import { StyleSheet } from 'react-native';
import type { QuizThemeColors } from './quiz-theme';

export function createQuizRewardedBadgeOfferStyles(colors: QuizThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      gap: 8,
      padding: 16,
    },
    description: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    error: {
      color: colors.error,
      fontSize: 13,
      fontWeight: '700',
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: 14,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontWeight: '800',
    },
    secondaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 12,
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
    },
  });
}
