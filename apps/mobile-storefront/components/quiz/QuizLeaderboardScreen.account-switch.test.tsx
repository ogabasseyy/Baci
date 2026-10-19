import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { fetchQuizEvents } from '@/services/quiz';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import type { QuizLeaderboard } from '@/services/quiz-types';
import { QuizLeaderboardScreen } from './QuizLeaderboardScreen';

jest.mock('@/services/quiz', () => ({ fetchQuizEvents: jest.fn() }));
jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
const mockAuthState: { user: { id: string } | null } = {
  user: { id: 'customer-1' },
};
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) => selector(mockAuthState),
}));

describe('QuizLeaderboardScreen account and row handling', () => {
  afterEach(() => {
    mockAuthState.user = { id: 'customer-1' };
    jest.clearAllMocks();
  });

  it('keeps the current player visible when the public board is capped at 100 rows', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2026-08-03T20:05:00Z',
        id: 'event-long',
        prizeName: 'Phone',
        questionCount: 20,
        startsAt: '2026-08-03T20:00:00Z',
        status: 'completed',
        title: 'Long quiz',
      },
    ]);
    const entries = Array.from({ length: 100 }, (_, index) => ({
      displayName: `Player-${index + 1}`,
      isCurrentCustomer: false,
      rank: index + 1,
      score: 20 - Math.floor(index / 10),
      status: 'ranked' as const,
      submittedAt: null,
      totalTimeSeconds: 120,
    }));
    jest.mocked(fetchQuizLeaderboard).mockResolvedValue({
      currentPlayer: {
        displayName: 'Me-OUTSIDE-TOP-100',
        isCurrentCustomer: true,
        rank: 101,
        score: 1,
        status: 'ranked',
        submittedAt: null,
        totalTimeSeconds: 180,
      },
      entries,
      participantCount: 101,
      status: 'published',
    });

    render(<QuizLeaderboardScreen />);
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'View leaderboard for Long quiz',
      })
    );

    expect(await screen.findByText('101 participants')).toBeTruthy();
    expect(screen.getByText(/Me-OUTSIDE-TOP-100/)).toBeTruthy();
  });

  it('does not apply an in-flight leaderboard response after the account changes', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2026-08-03T20:05:00Z',
        id: 'event-switch',
        prizeName: 'Phone',
        questionCount: 20,
        startsAt: '2026-08-03T20:00:00Z',
        status: 'completed',
        title: 'Account switch quiz',
      },
    ]);
    let resolveLeaderboard!: (value: QuizLeaderboard) => void;
    jest.mocked(fetchQuizLeaderboard).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLeaderboard = resolve;
        })
    );

    const { rerender } = render(<QuizLeaderboardScreen />);
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'View leaderboard for Account switch quiz',
      })
    );
    await act(async () => {
      await Promise.resolve();
    });

    mockAuthState.user = { id: 'customer-2' };
    rerender(<QuizLeaderboardScreen />);
    resolveLeaderboard({
      currentPlayer: {
        displayName: 'Old account',
        isCurrentCustomer: true,
        rank: 101,
        score: 1,
        status: 'ranked',
        submittedAt: null,
        totalTimeSeconds: 100,
      },
      entries: [],
      participantCount: 101,
      status: 'published',
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Old account')).toBeNull();
  });

  it('reloads past quizzes after the account changes', async () => {
    jest
      .mocked(fetchQuizEvents)
      .mockResolvedValueOnce([
        {
          endsAt: '2026-08-03T20:05:00Z',
          id: 'event-old-account',
          prizeName: 'Phone',
          questionCount: 5,
          startsAt: '2026-08-03T20:00:00Z',
          status: 'completed',
          title: 'Old account quiz',
        },
      ])
      .mockResolvedValueOnce([
        {
          endsAt: '2026-08-04T20:05:00Z',
          id: 'event-new-account',
          prizeName: 'Tablet',
          questionCount: 5,
          startsAt: '2026-08-04T20:00:00Z',
          status: 'completed',
          title: 'New account quiz',
        },
      ]);

    const { rerender } = render(<QuizLeaderboardScreen />);
    expect(
      await screen.findByRole('button', {
        name: 'View leaderboard for Old account quiz',
      })
    ).toBeTruthy();

    mockAuthState.user = { id: 'customer-2' };
    rerender(<QuizLeaderboardScreen />);

    expect(
      await screen.findByRole('button', {
        name: 'View leaderboard for New account quiz',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'View leaderboard for Old account quiz',
      })
    ).toBeNull();
    expect(fetchQuizEvents).toHaveBeenCalledTimes(2);
  });
});
