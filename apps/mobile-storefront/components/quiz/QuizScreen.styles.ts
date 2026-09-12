import { StyleSheet } from 'react-native';
import { createQuizQuestionStyles } from './QuizQuestion.styles';

export type QuizThemeColors = {
  background: string;
  border: string;
  card: string;
  error: string;
  muted: string;
  primary: string;
  primaryLowOpacity: string;
  primaryForeground: string;
  success: string;
  text: string;
  textSecondary: string;
  warning: string;
};

export function createQuizStyles(colors: QuizThemeColors) {
  return {
    ...StyleSheet.create({
      screen: { backgroundColor: colors.background, flex: 1 },
      container: {
        backgroundColor: colors.background,
        flexGrow: 1,
        gap: 16,
        padding: 20,
      },
      musicContainer: {
        backgroundColor: colors.background,
        paddingHorizontal: 20,
        paddingTop: 8,
      },
      header: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 16,
        justifyContent: 'space-between',
      },
      title: { color: colors.text, fontSize: 28, fontWeight: '800' },
      subtitle: { color: colors.textSecondary, fontSize: 15, marginTop: 4 },
      headerImage: { height: 72, resizeMode: 'contain', width: 72 },
      error: { color: colors.error, fontWeight: '700' },
      errorCard: {
        alignItems: 'center',
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 18,
        borderWidth: 1,
        gap: 12,
        padding: 24,
      },
      errorIcon: {
        alignItems: 'center',
        backgroundColor: colors.primaryLowOpacity,
        borderRadius: 28,
        height: 56,
        justifyContent: 'center',
        width: 56,
      },
      errorTitle: {
        color: colors.text,
        fontSize: 20,
        fontWeight: '800',
        textAlign: 'center',
      },
      errorDescription: {
        color: colors.textSecondary,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
      },
      errorSecondaryButton: {
        alignItems: 'center',
        borderColor: colors.border,
        borderRadius: 14,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 48,
        paddingHorizontal: 16,
        width: '100%',
      },
      introPanel: {
        backgroundColor: colors.primaryLowOpacity,
        borderColor: colors.primary,
        borderRadius: 8,
        borderWidth: 1,
        gap: 4,
        padding: 16,
      },
      introTitle: { color: colors.primary, fontSize: 16, fontWeight: '800' },
      introText: { color: colors.text, fontSize: 15, fontWeight: '700' },
      introMeta: { color: colors.textSecondary, fontSize: 14 },
      eventMeta: { color: colors.textSecondary, fontSize: 14 },
      primaryButton: {
        alignItems: 'center',
        backgroundColor: colors.primary,
        borderRadius: 14,
        justifyContent: 'center',
        minHeight: 48,
        paddingHorizontal: 16,
      },
      primaryButtonText: {
        color: colors.primaryForeground,
        fontSize: 16,
        fontWeight: '800',
      },
      timer: { color: colors.warning, fontWeight: '700' },
      passReceipt: { color: colors.textSecondary, fontWeight: '700' },
      resultCard: {
        alignItems: 'center',
        backgroundColor: colors.card,
        borderColor: colors.success,
        borderRadius: 24,
        borderWidth: 1,
        gap: 12,
        margin: 20,
        padding: 24,
      },
      resultIcon: {
        alignItems: 'center',
        backgroundColor: colors.primaryLowOpacity,
        borderRadius: 32,
        height: 64,
        justifyContent: 'center',
        width: 64,
      },
      resultTitle: {
        color: colors.success,
        fontSize: 22,
        fontWeight: '900',
        textAlign: 'center',
      },
      finishTimeCard: {
        alignItems: 'center',
        alignSelf: 'stretch',
        backgroundColor: colors.primaryLowOpacity,
        borderRadius: 16,
        gap: 3,
        padding: 16,
      },
      finishTimeLabel: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: '700',
      },
      finishTimeValue: {
        color: colors.primary,
        fontSize: 26,
        fontWeight: '900',
      },
      finishTimeHint: {
        color: colors.text,
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
      },
      leaderboardCountdownLabel: {
        color: colors.textSecondary,
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
      },
      leaderboardCountdown: {
        color: colors.warning,
        fontSize: 48,
        fontWeight: '900',
        letterSpacing: -1,
      },
      scoreSummary: { alignItems: 'center', gap: 2 },
      scoreValue: { color: colors.text, fontSize: 42, fontWeight: '900' },
      scoreLabel: {
        color: colors.textSecondary,
        fontSize: 14,
        fontWeight: '700',
      },
      resultScore: { color: colors.text, fontSize: 20, fontWeight: '800' },
      prizeWinText: { color: colors.success, fontSize: 16, fontWeight: '800' },
      prizeClaimHint: { color: colors.textSecondary, fontSize: 14 },
      finalStandings: {
        alignSelf: 'stretch',
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: 18,
        borderWidth: 1,
        gap: 10,
        padding: 16,
      },
      finalStandingsHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
      },
      finalStandingsTitle: {
        color: colors.primary,
        fontSize: 17,
        fontWeight: '900',
      },
      finalStandingsMeta: {
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: '700',
      },
      finalStandingRow: {
        alignItems: 'center',
        borderTopColor: colors.border,
        borderTopWidth: 1,
        flexDirection: 'row',
        gap: 10,
        minHeight: 46,
        paddingTop: 10,
      },
      finalStandingCurrentRow: {
        backgroundColor: colors.primaryLowOpacity,
        borderRadius: 10,
        marginHorizontal: -8,
        paddingHorizontal: 8,
      },
      finalStandingRank: {
        color: colors.primary,
        fontSize: 16,
        fontVariant: ['tabular-nums'],
        fontWeight: '900',
        width: 36,
      },
      finalStandingName: {
        color: colors.text,
        fontSize: 14,
        fontWeight: '800',
      },
      finalStandingIdentity: { flex: 1, gap: 2 },
      finalStandingTime: {
        color: colors.textSecondary,
        fontSize: 12,
        fontVariant: ['tabular-nums'],
        fontWeight: '600',
      },
      finalStandingScore: {
        color: colors.textSecondary,
        fontSize: 13,
        fontVariant: ['tabular-nums'],
        fontWeight: '800',
      },
      resultActionBox: {
        borderColor: colors.border,
        borderRadius: 14,
        borderWidth: 1,
        flex: 1,
        overflow: 'hidden',
      },
      resultsLayout: {
        backgroundColor: colors.background,
        flex: 1,
      },
      resultsScroll: { flex: 1 },
      resultsScrollContent: {
        flexGrow: 1,
        paddingBottom: 16,
      },
      resultActionsDock: {
        backgroundColor: colors.background,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 20,
        paddingVertical: 12,
      },
      resultAction: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        justifyContent: 'center',
        minHeight: 50,
        paddingHorizontal: 16,
      },
      secondaryButtonText: {
        color: colors.primary,
        fontSize: 15,
        fontWeight: '800',
      },
    }),
    ...createQuizQuestionStyles(colors),
  };
}
