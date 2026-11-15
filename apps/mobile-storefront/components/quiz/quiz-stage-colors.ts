import type { QuizThemeColors } from './quiz-theme';

/**
 * SuperQuiz plays on one fixed "stage": the deep maroon of the refreshed
 * home header, in both light and dark mode, so the quiz reads as a game
 * rather than another store page. Every quiz style sheet is driven by
 * `QuizThemeColors`, so swapping the palette restyles all quiz screens.
 *
 * Surfaces that sit on the stage as bright tiles (answers, prize tickets)
 * use `QUIZ_TILE` instead, because stage `text` is white.
 */
export const QUIZ_STAGE_COLORS: QuizThemeColors = {
  background: '#1B0709',
  border: 'rgba(255,255,255,0.16)',
  card: 'rgba(255,255,255,0.08)',
  error: '#FF8A8A',
  muted: 'rgba(255,255,255,0.14)',
  primary: '#F04343',
  primaryForeground: '#FFFFFF',
  primaryLowOpacity: 'rgba(240,67,67,0.18)',
  success: '#34D399',
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.72)',
  warning: '#F5A524',
};

/** Bright scalloped tiles that sit on the stage. */
export const QUIZ_TILE = {
  background: '#FFFFFF',
  selectedBackground: '#FFF1D6',
  text: '#170D0F',
  textSecondary: '#6D5B5E',
} as const;

/** One colour per answer position, so answers are told apart at a glance. */
export const QUIZ_ANSWER_ACCENTS = [
  '#DC2626',
  '#2563EB',
  '#059669',
  '#D97706',
] as const;

export function getQuizAnswerAccent(index: number): string {
  return QUIZ_ANSWER_ACCENTS[index % QUIZ_ANSWER_ACCENTS.length] as string;
}

/**
 * A half-width tile shows two lines of about a dozen characters each on the
 * narrowest phones (360pt). Anything longer goes to full-width rows, which
 * never truncate, so a player always sees the whole answer before tapping.
 */
export const QUIZ_ANSWER_GRID_MAX_LABEL_LENGTH = 22;

/** One tile line holds about this many characters; a longer word cannot wrap. */
export const QUIZ_ANSWER_GRID_MAX_WORD_LENGTH = 11;

/**
 * The character limit above is tuned for Latin letters, digits and common
 * punctuation. Every other script (CJK, Thai, Arabic, Devanagari, emoji…)
 * has wider or stacking glyphs, so those answers always use full rows.
 */
const TILE_SAFE_TEXT_PATTERN = /^[\u0020-\u024F\u2010-\u2027\u20A0-\u20BF]*$/;

/** The limits above assume at least this window width (split screen is narrower). */
export const QUIZ_ANSWER_GRID_MIN_WINDOW_WIDTH = 340;

/** Short answers sit in a 2×2 grid; long ones fall back to full-width rows. */
export function shouldUseQuizAnswerGrid(
  labels: readonly string[],
  windowWidth: number = QUIZ_ANSWER_GRID_MIN_WINDOW_WIDTH
): boolean {
  return (
    windowWidth >= QUIZ_ANSWER_GRID_MIN_WINDOW_WIDTH &&
    labels.length === 4 &&
    labels.every(
      (label) =>
        label.length <= QUIZ_ANSWER_GRID_MAX_LABEL_LENGTH &&
        label
          .split(/\s+/)
          .every((word) => word.length <= QUIZ_ANSWER_GRID_MAX_WORD_LENGTH) &&
        TILE_SAFE_TEXT_PATTERN.test(label)
    )
  );
}

/** Native-stack header options so the header joins the stage. */
export const QUIZ_STAGE_HEADER_OPTIONS = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: QUIZ_STAGE_COLORS.background },
  headerTintColor: QUIZ_STAGE_COLORS.text,
  headerTitleStyle: { color: QUIZ_STAGE_COLORS.text },
} as const;
