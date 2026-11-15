import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, View } from 'react-native';
import {
  QUIZ_SCROLL_RESET_WINDOW_MS,
  QuizGameplayScrollView,
} from './QuizGameplayScrollView';
import { createQuizStyles } from './QuizScreen.styles';
import type { QuizThemeColors } from './quiz-theme';

const colors: QuizThemeColors = {
  background: '#000',
  border: '#222',
  card: '#111',
  error: '#f00',
  muted: '#555',
  primary: '#f90',
  primaryLowOpacity: '#321',
  primaryForeground: '#000',
  success: '#0f8',
  text: '#fff',
  textSecondary: '#aaa',
  warning: '#fb0',
};

describe('QuizGameplayScrollView', () => {
  it('keeps gameplay content reachable in a bounded scroll surface', () => {
    render(
      <QuizGameplayScrollView styles={createQuizStyles(colors)}>
        <View />
      </QuizGameplayScrollView>
    );

    expect(screen.getByTestId('quiz-gameplay-scroll')).toBeTruthy();
  });

  it('bugfix: a new question opened part-way down; it now starts at the top', () => {
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => undefined);
    const styles = createQuizStyles(colors);
    const view = render(
      <QuizGameplayScrollView topKey="question-1" styles={styles}>
        <View />
      </QuizGameplayScrollView>
    );
    scrollTo.mockClear();

    view.rerender(
      <QuizGameplayScrollView topKey="question-2" styles={styles}>
        <View />
      </QuizGameplayScrollView>
    );

    expect(scrollTo).toHaveBeenCalledWith({ animated: false, y: 0 });

    // The new question lays out after the key changes: reset once more,
    // then leave the player's own scrolling alone.
    scrollTo.mockClear();
    const scroll = screen.getByTestId('quiz-gameplay-scroll');
    fireEvent(scroll, 'contentSizeChange', 320, 900);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent(scroll, 'contentSizeChange', 320, 950);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockRestore();
  });

  it('bugfix: a late size change pulled the player back to the top mid-question', () => {
    jest.useFakeTimers();
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => undefined);
    const styles = createQuizStyles(colors);
    render(
      <QuizGameplayScrollView topKey="question-1" styles={styles}>
        <View />
      </QuizGameplayScrollView>
    );
    scrollTo.mockClear();

    // No size change follows the question change (same height as before),
    // then an ad loads well into the question.
    act(() => {
      jest.advanceTimersByTime(QUIZ_SCROLL_RESET_WINDOW_MS + 1);
    });
    fireEvent(
      screen.getByTestId('quiz-gameplay-scroll'),
      'contentSizeChange',
      320,
      980
    );

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
    jest.useRealTimers();
  });
});
