import { StyleSheet } from 'react-native';
import { QUIZ_TILE } from './quiz-stage-colors';
import type { QuizThemeColors } from './quiz-theme';

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
      color: colors.warning,
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    title: { color: colors.text, fontSize: 28, fontWeight: '900' },
    prize: { color: QUIZ_TILE.text, fontSize: 18, fontWeight: '900' },
    prizeTicket: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 64,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    prizeTicketCopy: { flex: 1 },
    prizeTicketLabel: {
      color: QUIZ_TILE.textSecondary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    adNotice: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    countdownLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1.4,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    countdown: {
      color: colors.warning,
      fontSize: 76,
      letterSpacing: -2,
      lineHeight: 84,
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
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 16,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: 15,
      fontWeight: '800',
    },
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
