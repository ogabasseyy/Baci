import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  fetchQuizLeaderboard,
  fetchQuizLiveLeaderboard,
  fetchQuizParticipantCount,
} from '@/services/quiz-leaderboard';
import { useQuizStore } from '@/stores/quiz-store';
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
  fetchQuizLiveLeaderboard: jest.fn(),
  fetchQuizParticipantCount: jest.fn(async () => 0),
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

describe('QuizResultsPanel', () => {
  beforeEach(() => {
    jest.mocked(fetchQuizLeaderboard).mockReset();
    jest.mocked(fetchQuizLiveLeaderboard).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockResolvedValue(0);
  });

  it('celebrates completion and explains the server-recorded tie-break time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: {
        displayName: 'Bassey',
        isCurrentCustomer: true,
        rank: 1,
        score: 4,
        status: 'submitted',
        submittedAt: new Date(0).toISOString(),
        totalTimeSeconds: 10,
      },
      entries: [],
      participantCount: 1,
      status: 'live',
    });
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
          attemptId: 'a1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("You're all done!")).toBeTruthy();
    expect(screen.getByText('You finished at')).toBeTruthy();
    expect(screen.getByText(/:\d{2}:\d{2}/)).toBeTruthy();
    expect(
      screen.getByText('Finish time will be used as a tie breaker')
    ).toBeTruthy();
    expect(
      screen.getByText('The leaderboard will appear when the quiz ends in')
    ).toBeTruthy();
    expect(screen.getByRole('timer').props.children).toBe('0:30');
    jest.useRealTimers();
  });

  it('shows the winner claim first and labels history as a secondary action', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
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

    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText(/points · 10 questions/)).toBeTruthy();
    expect(screen.getByText('Claim your prize')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'View past quiz leaderboards' })
    ).toBeTruthy();
    expect(screen.queryByText('View full leaderboard')).toBeNull();
  });

  it('requests standings after the event deadline while results are still pending', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.mocked(fetchQuizLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [],
      participantCount: 0,
      status: 'published',
    });
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
    expect(fetchQuizLeaderboard).toHaveBeenCalledWith({
      eventId: 'event-1',
      expectedUserId: 'user-1',
    });
    jest.useRealTimers();
  });

  it('shows provisional standings immediately after the player finishes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [
        {
          displayName: 'Bassey',
          isCurrentCustomer: true,
          rank: 1,
          score: 8,
          status: 'submitted',
          submittedAt: new Date(0).toISOString(),
          totalTimeSeconds: 42,
        },
      ],
      participantCount: null,
      status: 'live',
    });
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
    await act(async () => Promise.resolve());
    expect(screen.getByText('Live standings')).toBeTruthy();
    expect(screen.getByText(/Bassey/)).toBeTruthy();
  });

  it('keeps loaded standings visible while final publication is retried', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [
        {
          displayName: 'Bassey',
          isCurrentCustomer: true,
          rank: 1,
          score: 8,
          status: 'submitted',
          submittedAt: new Date(0).toISOString(),
          totalTimeSeconds: 42,
        },
      ],
      participantCount: null,
      status: 'live',
    });
    jest
      .mocked(fetchQuizLeaderboard)
      .mockRejectedValue(new Error('not deployed'));
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
    await act(async () => Promise.resolve());
    await act(async () => {
      jest.advanceTimersByTime(1_250);
      await Promise.resolve();
    });
    expect(screen.getByText(/Bassey/)).toBeTruthy();
    expect(screen.queryByLabelText('Loading final standings')).toBeNull();
  });

  it('retries standings while server publication is still finishing', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(30_000);
    jest
      .mocked(fetchQuizLeaderboard)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({
        currentPlayer: null,
        entries: [],
        participantCount: 0,
        status: 'published',
      });

    render(
      <QuizResultsPanel
        eventId="event-1"
        eventEndsAt={new Date(1_000).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="pending_results"
        serverNow={new Date(30_000).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchQuizLeaderboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchQuizLeaderboard).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('returns to the event list from a final result', () => {
    useQuizStore.setState({ status: 'result' });
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'final',
          availableAt: new Date().toISOString(),
          rank: 1,
          score: 8,
          totalQuestions: 10,
        }}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Back to quiz events' })
    );
    expect(useQuizStore.getState().status).toBe('idle');
  });

  it('explains explicitly cancelled events instead of a missing attempt', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="event_cancelled"
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'unavailable',
          reason: 'event_cancelled',
        }}
      />
    );

    expect(screen.getByText('Quiz cancelled')).toBeTruthy();
    expect(
      screen.getByText(
        'This quiz event was cancelled. Return to the quiz list to join another event.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Quiz result unavailable')).toBeNull();
  });

  it('returns to the event list from a legacy result', () => {
    useQuizStore.setState({ status: 'result' });
    render(
      <QuizResultsPanel
        legacyResult={{
          attemptId: 'attempt-1',
          correctAnswers: 8,
          prizeEligible: false,
          status: 'completed',
          totalQuestions: 10,
        }}
        lifecycle="idle"
        styles={createQuizStyles(colors)}
        v2Result={null}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Back to quiz events' })
    );
    expect(useQuizStore.getState().status).toBe('idle');
  });
});
