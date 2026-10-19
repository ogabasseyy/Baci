import { describe, expect, it } from '@jest/globals';
import { createQuizStyles } from './QuizScreen.styles';
import type { QuizThemeColors } from './quiz-theme';

const mockColors: QuizThemeColors = {
  background: '#ffffff',
  border: '#e5e7eb',
  card: '#f9fafb',
  error: '#ef4444',
  muted: '#f3f4f6',
  primary: '#dc2626',
  primaryForeground: '#ffffff',
  primaryLowOpacity: 'rgba(220, 38, 38, 0.08)',
  success: '#10b981',
  text: '#111827',
  textSecondary: '#4b5563',
  warning: '#f59e0b',
};

describe('createQuizStyles', () => {
  it('maps quiz theme colors onto the rendered style keys', () => {
    const styles = createQuizStyles(mockColors);

    expect(styles.screen.backgroundColor).toBe(mockColors.background);
    expect(styles.container.backgroundColor).toBe(mockColors.background);
    expect(styles.title.color).toBe(mockColors.text);
    expect(styles.primaryButton.backgroundColor).toBe(mockColors.primary);
    expect(styles.primaryButtonText.color).toBe(mockColors.primaryForeground);
    expect(styles.introPanel.backgroundColor).toBe(
      mockColors.primaryLowOpacity
    );
    expect(styles.introPanel.borderColor).toBe(mockColors.primary);
    expect(styles.introTitle.color).toBe(mockColors.primary);
    expect(styles.answerButton.borderColor).toBe(mockColors.border);
    expect(styles.answerButtonSelected.backgroundColor).toBe(
      mockColors.primaryLowOpacity
    );
    expect(styles.progressFill.backgroundColor).toBe(mockColors.primary);
    expect(styles.resultTitle.color).toBe(mockColors.success);
  });

  it('does not invent fallback colors when runtime color slots are missing', () => {
    const partialColors = {
      ...mockColors,
      background: undefined,
      border: undefined,
      primary: undefined,
    } as unknown as QuizThemeColors;

    const styles = createQuizStyles(partialColors);

    expect(styles.screen.backgroundColor).toBeUndefined();
    expect(styles.primaryButton.backgroundColor).toBeUndefined();
    expect(styles.answerButton.borderColor).toBeUndefined();
  });

  it('passes invalid runtime color values through unchanged', () => {
    const invalidColors = {
      ...mockColors,
      primary: 'not-a-color',
      warning: null,
    } as unknown as QuizThemeColors;

    const styles = createQuizStyles(invalidColors);

    expect(styles.primaryButton.backgroundColor).toBe('not-a-color');
    expect(styles.timer.color).toBeNull();
  });
});
