import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizParticipantCount } from '@/services/quiz-participant-count';
import { QuizResultsPanel } from './QuizResultsPanel';
import { createQuizStyles, type QuizThemeColors } from './QuizScreen.styles';

jest.mock('./QuizPrizeClaimPanel', () => ({
  QuizPrizeClaimPanel: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(Text, null, 'Claim your prize');
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
jest.mock('@/services/quiz-participant-count', () => ({
  fetchQuizParticipantCount: jest.fn(),
}));

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

describe('QuizResultsPanel lifecycle', () => {
  beforeEach(() => {
    jest.mocked(fetchQuizLeaderboard).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockResolvedValue(1);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the winner claim first and labels history as a secondary action', () => {
    const onReturnToQuizList = jest.fn();
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        onReturnToQuizList={onReturnToQuizList}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'a1',
          availability: 'final',
          availableAt: new Date().toISOString(),
          rank: 3,
          score: 8,
          totalQuestions: 10,
          prizeClaim: {
            awardId: 'award-1',
            cartPath: '/ogabassey/cart',
            condition: null,
            productId: 'product-1',
            variantId: null,
            voucherToken: 'voucher-1',
          },
        }}
      />
    );

    expect(screen.getByTestId('quiz-results-scroll')).toBeTruthy();
    expect(screen.getByText(/points · 10 questions/)).toBeTruthy();
    expect(screen.queryByText('Your quiz attempt is closed.')).toBeNull();
    expect(screen.getByText('Claim your prize')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'View past quiz leaderboards' })
    ).toBeTruthy();
    const resultScroll = screen.getByTestId('quiz-results-scroll');
    const actionsDock = screen.getByTestId('quiz-results-actions');
    expect(
      within(resultScroll).queryByRole('button', {
        name: 'View past quiz leaderboards',
      })
    ).toBeNull();
    expect(
      within(actionsDock).getByRole('button', {
        name: 'View past quiz leaderboards',
      })
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Return to quiz list' })
    );
    expect(onReturnToQuizList).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('View full leaderboard')).toBeNull();
  });

  it('waits for result publication instead of starting a second standings loop', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    render(
      <QuizResultsPanel
        eventId="event-1"
        eventEndsAt={new Date(1_000).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="pending_results"
        serverNow={new Date(0).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    expect(fetchQuizLeaderboard).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1_250);
      await Promise.resolve();
    });
    expect(fetchQuizLeaderboard).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Opening final standings')).toBeTruthy();
  });

  it('shows the finish receipt and countdown before publication', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    render(
      <QuizResultsPanel
        eventId="event-1"
        eventEndsAt={new Date(30_000).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="pending_results"
        serverNow={new Date(0).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    expect(screen.getByText("You're all done!")).toBeTruthy();
    expect(screen.getByText('You finished at')).toBeTruthy();
    expect(
      screen.getByText('Finish time will be used as a tie breaker')
    ).toBeTruthy();
    expect(
      screen.getByText('The leaderboard will appear when the quiz ends in')
    ).toBeTruthy();
    expect(screen.getByRole('timer')).toHaveTextContent('0:30');
    expect(fetchQuizLeaderboard).not.toHaveBeenCalled();
  });

  it('offers another attempt while a multi-attempt event is still open', () => {
    const onReturnToQuizList = jest.fn();
    render(
      <QuizResultsPanel
        allowPendingResultsExit
        eventId="event-1"
        eventEndsAt={new Date(30_000).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="pending_results"
        onReturnToQuizList={onReturnToQuizList}
        serverNow={new Date(0).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Play again' }));
    expect(onReturnToQuizList).toHaveBeenCalledTimes(1);
  });

  it('loads final standings once after the final result becomes available', async () => {
    jest.mocked(fetchQuizLeaderboard).mockResolvedValue({
      currentPlayer: {
        displayName: 'Bassey',
        isCurrentCustomer: true,
        rank: 1,
        score: 8,
        status: 'completed',
        submittedAt: new Date(0).toISOString(),
        totalTimeSeconds: 42,
      },
      entries: [],
      participantCount: 1,
      status: 'published',
    });
    render(
      <QuizResultsPanel
        eventId="event-1"
        eventEndsAt={new Date(0).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="final"
        serverNow={new Date(0).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'final',
          availableAt: new Date(0).toISOString(),
          rank: 1,
          score: 8,
          totalQuestions: 5,
        }}
      />
    );

    expect(await screen.findByText('Final standings')).toBeTruthy();
    expect(screen.getByLabelText('Rank 1, Bassey, score 8')).toBeTruthy();
    expect(fetchQuizLeaderboard).toHaveBeenCalledTimes(1);
  });

  it('keeps the authoritative score visible when standings are unavailable', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'final',
          availableAt: new Date(0).toISOString(),
          rank: 1,
          score: 4,
          totalQuestions: 5,
        }}
      />
    );

    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('points · 5 questions')).toBeTruthy();
    expect(screen.queryByText('Final standings')).toBeNull();
  });
});
