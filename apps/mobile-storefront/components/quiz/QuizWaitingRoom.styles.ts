import { StyleSheet } from 'react-native';
import type { QuizThemeColors } from './QuizScreen.styles';

export function createQuizWaitingRoomStyles(colors: QuizThemeColors) {
  return StyleSheet.create({
    screen: { backgroundColor: colors.background, flex: 1 },
    scrollView: { flex: 1 },
    scrollContent: { flexGrow: 1, padding: 20, paddingBottom: 40 },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: 24,
      borderWidth: 1,
      gap: 18,
      padding: 22,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    title: { color: colors.text, fontSize: 28, fontWeight: '900' },
    prize: { color: colors.textSecondary, fontSize: 17, fontWeight: '700' },
    countdownLabel: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    countdown: {
      color: colors.warning,
      fontSize: 52,
      fontVariant: ['tabular-nums'],
      fontWeight: '900',
      textAlign: 'center',
    },
    meta: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      gap: 7,
      paddingVertical: 14,
    },
    metaText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
    error: { color: colors.warning, fontSize: 13, textAlign: 'center' },
    secondaryButton: {
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
}
