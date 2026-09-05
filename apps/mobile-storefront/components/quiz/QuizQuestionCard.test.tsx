import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { QuizAttempt } from '@/services/quiz-types';
import { QuizQuestionCard } from './QuizQuestionCard';
import { createQuizStyles, type QuizThemeColors } from './QuizScreen.styles';

const themeColors: QuizThemeColors = {
  background: '#fff',
  border: '#ddd',
  card: '#fff',
  error: '#dc2626',
  muted: '#e5e7eb',
  primary: '#dc2626',
  primaryLowOpacity: 'rgba(220, 38, 38, 0.1)',
  primaryForeground: '#fff',
  success: '#16a34a',
  text: '#111827',
  textSecondary: '#6b7280',
  warning: '#f59e0b',
};

const attempt: QuizAttempt = {
  attemptId: 'attempt-1',
  eventId: 'event-1',
  examPassPointsSpent: 1,
  remainingLoyaltyPoints: 4,
  question: {
    deadlineAt: '2026-07-08T12:00:30.000Z',
    id: 'question-1',
    prompt: 'Pick the answer',
    options: [
      { id: 'a', label: 'First' },
      { id: 'b', label: 'Second' },
    ],
    timeLimitSeconds: 30,
    index: 1,
    total: 3,
  },
};

function renderCard(
  overrides: Partial<Parameters<typeof QuizQuestionCard>[0]> = {}
) {
  const props = {
    attempt,
    isSubmitting: false,
    onSelectAnswer: jest.fn(),
    onSubmit: jest.fn(),
    remainingSeconds: 12,
    selectedOptionId: null as string | null,
    styles: createQuizStyles(themeColors),
    ...overrides,
  };
  render(<QuizQuestionCard {...props} />);
  return props;
}

describe('QuizQuestionCard', () => {
  it('renders the prompt, countdown, and answer options', () => {
    renderCard();

    expect(screen.getByText('Pick the answer')).toBeTruthy();
    expect(screen.getByLabelText('Time left: 12 seconds')).toBeTruthy();
    expect(screen.getByLabelText('Answer First')).toBeTruthy();
    expect(screen.getByLabelText('Answer Second')).toBeTruthy();
  });

  it('selecting an option fires onSelectAnswer with the option id', () => {
    const props = renderCard();

    fireEvent.press(screen.getByLabelText('Answer Second'));

    expect(props.onSelectAnswer).toHaveBeenCalledWith('b');
  });

  it('submits the selected answer when one is chosen', () => {
    const props = renderCard({ selectedOptionId: 'b' });
    expect(screen.getByLabelText('Selected answer')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Submit answer'));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables submit until an option is selected', () => {
    renderCard({ selectedOptionId: null });

    expect(
      screen.getByLabelText('Submit answer').props.accessibilityState.disabled
    ).toBe(true);
  });

  it('disables answer options and submit while submitting', () => {
    renderCard({ isSubmitting: true, selectedOptionId: 'b' });

    expect(
      screen.getByLabelText('Answer First').props.accessibilityState.disabled
    ).toBe(true);
    expect(
      screen.getByLabelText('Submit answer').props.accessibilityState.disabled
    ).toBe(true);
  });
});
