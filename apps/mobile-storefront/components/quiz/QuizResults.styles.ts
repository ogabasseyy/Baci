import { StyleSheet } from 'react-native';
import { QUIZ_TILE } from './quiz-stage-colors';
import type { QuizThemeColors } from './quiz-theme';

const PODIUM_GOLD = '#F5A524';
const PODIUM_SILVER = '#C9CED6';
const PODIUM_BRONZE = '#D08B5B';

export const QUIZ_PODIUM_MEDALS = [
  PODIUM_GOLD,
  PODIUM_SILVER,
  PODIUM_BRONZE,
] as const;

/** Styles for the finished and results screens on the quiz stage. */
export function createQuizResultsStyles(colors: QuizThemeColors) {
  return StyleSheet.create({
    stageCountdownBlock: { alignItems: 'center', gap: 2 },
    stageCountdownLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    stageCountdown: {
      color: colors.warning,
      fontSize: 84,
      fontVariant: ['tabular-nums'],
      fontWeight: '900',
      letterSpacing: -3,
      lineHeight: 92,
    },
    stageCountdownHint: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    countingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'center',
      paddingVertical: 12,
    },
    countingText: { color: colors.text, fontSize: 18, fontWeight: '800' },
    finishTimeLine: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    podium: {
      alignItems: 'flex-end',
      alignSelf: 'stretch',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      paddingTop: 6,
    },
    podiumColumn: { alignItems: 'center', flex: 1, gap: 6 },
    podiumName: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
      textAlign: 'center',
    },
    podiumYou: { color: colors.warning },
    podiumScore: {
      color: colors.textSecondary,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      fontWeight: '700',
    },
    podiumStep: {
      alignItems: 'center',
      alignSelf: 'stretch',
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      justifyContent: 'center',
    },
    podiumStepFirst: { height: 92 },
    podiumStepSecond: { height: 68 },
    podiumStepThird: { height: 50 },
    podiumRank: { color: QUIZ_TILE.text, fontSize: 24, fontWeight: '900' },
    standingsGap: {
      color: colors.warning,
      fontSize: 13,
      fontWeight: '800',
      textAlign: 'center',
    },
    standingsHidden: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    resultsAdSlot: { alignSelf: 'stretch' },
  });
}
