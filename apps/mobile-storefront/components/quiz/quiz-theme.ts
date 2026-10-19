/**
 * Shared quiz theme colors. Lives here (instead of QuizScreen.styles) so
 * style modules don't import each other in a cycle.
 */
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
