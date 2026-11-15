import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizLiveQuestionCard } from './QuizLiveQuestionCard';
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

describe('QuizLiveQuestionCard', () => {
  it('locks a one-tap answer and exposes both deadlines', () => {
    const onAnswer = jest.fn();
    const now = Date.now();
    render(
      <QuizLiveQuestionCard
        attempt={{
          attemptId: 'a1',
          eventEndsAt: new Date(now + 30_000).toISOString(),
          eventId: 'e1',
          serverNow: new Date(now).toISOString(),
          status: 'in_progress',
          resultsAvailableAt: null,
          question: {
            deadlineAt: new Date(now + 10_000).toISOString(),
            id: 'q1',
            index: 1,
            options: [{ id: 'o1', label: 'Lagos' }],
            prompt: 'Capital?',
            timeLimitSeconds: 10,
            total: 20,
          },
        }}
        lockedOptionId={null}
        onAnswer={onAnswer}
        styles={createQuizStyles(colors)}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Answer Lagos' }));
    expect(onAnswer).toHaveBeenCalledWith('o1');
  });

  function renderWithOptions(labels: string[]) {
    const now = Date.now();
    render(
      <QuizLiveQuestionCard
        attempt={{
          attemptId: 'a1',
          eventEndsAt: new Date(now + 30_000).toISOString(),
          eventId: 'e1',
          serverNow: new Date(now).toISOString(),
          status: 'in_progress',
          resultsAvailableAt: null,
          question: {
            deadlineAt: new Date(now + 10_000).toISOString(),
            id: 'q1',
            index: 1,
            options: labels.map((label, index) => ({
              id: `o${index + 1}`,
              label,
            })),
            prompt: 'Capital?',
            timeLimitSeconds: 10,
            total: 20,
          },
        }}
        lockedOptionId="o2"
        onAnswer={jest.fn()}
        styles={createQuizStyles(colors)}
      />
    );
  }

  it('lays four short answers out as a grid of lettered tiles', () => {
    renderWithOptions(['Lagos', 'Abuja', 'Kano', 'Ibadan']);

    expect(screen.getByTestId('quiz-answers-grid')).toBeTruthy();
    // bugfix: a two-line cap could hide the end of an answer on Android.
    expect(screen.getByText('Ibadan').props.numberOfLines).toBeUndefined();
    for (const letter of ['A', 'B', 'C', 'D']) {
      expect(screen.getByText(letter)).toBeTruthy();
    }
    expect(
      screen.getByRole('button', { name: 'Answer Abuja' }).props
        .accessibilityState
    ).toEqual({ disabled: true, selected: true });
  });

  it('falls back to full-width rows when an answer is too long for a tile', () => {
    renderWithOptions([
      'Lagos',
      'Abuja',
      'Kano',
      'The city that was the capital before the move to Abuja in 1991',
    ]);

    expect(screen.getByTestId('quiz-answers-list')).toBeTruthy();
    expect(screen.queryByTestId('quiz-answers-grid')).toBeNull();
  });
});
