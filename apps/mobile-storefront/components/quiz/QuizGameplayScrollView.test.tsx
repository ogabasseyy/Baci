import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { QuizGameplayScrollView } from './QuizGameplayScrollView';
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
});
