import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { QuizLiveQuestionCard } from './QuizLiveQuestionCard';
import { createQuizStyles } from './QuizScreen.styles';
import type { QuizThemeColors } from './quiz-theme';

jest.mock('./QuizMusicPlayer', () => {
  const { Text, View } = require('react-native');
  return {
    QuizMusicPlayer: ({ gameEndsIn }: { gameEndsIn?: string }) => (
      <View>
        <Text>Game ends in {gameEndsIn}</Text>
      </View>
    ),
  };
});

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

describe('QuizLiveQuestionCard timing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('submits an unanswered timeout once', () => {
    const onAnswer = jest.fn();
    const attempt = {
      attemptId: 'a1',
      eventEndsAt: new Date(30_000).toISOString(),
      eventId: 'e1',
      question: {
        deadlineAt: new Date(1_000).toISOString(),
        id: 'q1',
        index: 1,
        options: [{ id: 'o1', label: 'Lagos' }],
        prompt: 'Capital?',
        timeLimitSeconds: 1,
        total: 20,
      },
      resultsAvailableAt: null,
      serverNow: new Date(0).toISOString(),
      status: 'in_progress' as const,
    };

    render(
      <QuizLiveQuestionCard
        attempt={attempt}
        lockedOptionId={null}
        onAnswer={onAnswer}
        styles={createQuizStyles(colors)}
      />
    );
    act(() => jest.advanceTimersByTime(2_000));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('__timeout_no_answer__');
  });

  it('counts down from a stable server clock snapshot', () => {
    const attempt = {
      attemptId: 'a1',
      eventEndsAt: new Date(30_000).toISOString(),
      eventId: 'e1',
      question: {
        deadlineAt: new Date(10_000).toISOString(),
        id: 'q1',
        index: 1,
        options: [{ id: 'o1', label: 'Lagos' }],
        prompt: 'Capital?',
        timeLimitSeconds: 10,
        total: 5,
      },
      resultsAvailableAt: null,
      serverNow: new Date(0).toISOString(),
      status: 'in_progress' as const,
    };

    render(
      <QuizLiveQuestionCard
        attempt={attempt}
        lockedOptionId={null}
        onAnswer={jest.fn()}
        styles={createQuizStyles(colors)}
      />
    );
    expect(screen.getByRole('timer')).toHaveTextContent('10s left');

    act(() => jest.advanceTimersByTime(1_250));

    expect(screen.getByRole('timer')).toHaveTextContent('9s left');
  });

  it('starts the next server-issued question at its full time limit', () => {
    const createAttempt = (questionIndex: number) => ({
      attemptId: 'a1',
      eventEndsAt: new Date(60_000).toISOString(),
      eventId: 'e1',
      question: {
        deadlineAt: new Date(questionIndex * 10_000).toISOString(),
        id: `q${questionIndex}`,
        index: questionIndex,
        options: [{ id: 'o1', label: 'Lagos' }],
        prompt: 'Capital?',
        timeLimitSeconds: 10,
        total: 5,
      },
      resultsAvailableAt: null,
      serverNow: new Date((questionIndex - 1) * 10_000).toISOString(),
      status: 'in_progress' as const,
    });
    const { rerender } = render(
      <QuizLiveQuestionCard
        attempt={createAttempt(1)}
        lockedOptionId={null}
        onAnswer={jest.fn()}
        styles={createQuizStyles(colors)}
      />
    );

    act(() => jest.advanceTimersByTime(10_000));
    rerender(
      <QuizLiveQuestionCard
        attempt={createAttempt(2)}
        lockedOptionId={null}
        onAnswer={jest.fn()}
        styles={createQuizStyles(colors)}
      />
    );

    expect(screen.getByRole('timer')).toHaveTextContent('10s left');
  });

  it('caps the question timer at the event end using server offset', () => {
    const onAnswer = jest.fn();
    const onEventExpire = jest.fn();
    const attempt = {
      attemptId: 'a1',
      eventEndsAt: new Date(10_000).toISOString(),
      eventId: 'e1',
      question: {
        deadlineAt: new Date(20_000).toISOString(),
        id: 'q1',
        index: 1,
        options: [{ id: 'o1', label: 'Lagos' }],
        prompt: 'Capital?',
        timeLimitSeconds: 20,
        total: 20,
      },
      resultsAvailableAt: null,
      serverNow: new Date(5_000).toISOString(),
      status: 'in_progress' as const,
    };

    render(
      <QuizLiveQuestionCard
        attempt={attempt}
        lockedOptionId={null}
        onAnswer={onAnswer}
        onEventExpire={onEventExpire}
        styles={createQuizStyles(colors)}
      />
    );
    act(() => jest.advanceTimersByTime(5_250));

    expect(onEventExpire).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
