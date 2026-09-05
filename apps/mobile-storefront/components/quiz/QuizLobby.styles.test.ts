import { createQuizLobbyStyles } from './QuizLobby.styles';
import type { QuizThemeColors } from './QuizScreen.styles';

const colors: QuizThemeColors = {
  background: '#ffffff',
  border: '#dddddd',
  card: '#ffffff',
  error: '#dc2626',
  muted: '#eeeeee',
  primary: '#dc2626',
  primaryLowOpacity: '#ffeeee',
  primaryForeground: '#ffffff',
  success: '#16803c',
  text: '#111111',
  textSecondary: '#444444',
  warning: '#a16207',
};

it('keeps light-mode prize cards readable and closed controls distinguishable', () => {
  const styles = createQuizLobbyStyles(colors);
  expect(styles.eventCard.backgroundColor).toBe(colors.card);
  expect(styles.eventCardClosed).not.toHaveProperty('opacity');
  expect(styles.eventCardClosed.backgroundColor).toBe(colors.muted);
  expect(styles.disabledButtonBox.backgroundColor).toBe(colors.card);
  expect(styles.disabledButtonBox.borderWidth).toBe(1);
});
