import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { fetchQuizEvents } from '@/services/quiz';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
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

describe('QuizLeaderboardScreen', () => {
  afterEach(() => {
    mockAuthState.user = { id: 'customer-1' };
    jest.clearAllMocks();
  });

  it('browses a past quiz and shows published standings', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2026-08-03T20:05:00Z',
        id: 'event-1',
        prizeName: 'Phone',
        questionCount: 20,
        startsAt: '2026-08-03T20:00:00Z',
        status: 'completed',
        title: 'Tonight quiz',
      },
      {
        endsAt: null,
        id: 'event-2',
        prizeName: 'Tablet',
        questionCount: 5,
        startsAt: null,
        status: 'active',
        title: 'Current quiz',
      },
    ]);
    jest.mocked(fetchQuizLeaderboard).mockResolvedValue({
      currentPlayer: null,
      entries: [
        {
          displayName: 'Player-AB12CD34',
          isCurrentCustomer: false,
          rank: 1,
          score: 18,
          status: 'ranked',
          submittedAt: null,
          totalTimeSeconds: 120,
        },
      ],
      participantCount: 1,
      status: 'published',
    });

    render(<QuizLeaderboardScreen />);
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'View leaderboard for Tonight quiz',
      })
    );

    expect(await screen.findByText('Final standings')).toBeTruthy();
    expect(screen.getByText('1 participant')).toBeTruthy();
    expect(screen.getByText('Player-AB12CD34')).toBeTruthy();
    expect(screen.queryByText('Current quiz')).toBeNull();
  });

  it('shows an accessible error when history cannot load', async () => {
    jest.mocked(fetchQuizEvents).mockRejectedValue(new Error('offline'));
    render(<QuizLeaderboardScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Past leaderboards are unavailable.'
    );
  });

  it('uses the server clock when deciding which active quizzes are past', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-03T21:00:00Z'));
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2026-08-03T20:05:00Z',
        id: 'event-server-past',
        prizeName: 'Phone',
        questionCount: 20,
        serverNow: '2026-08-03T20:10:00Z',
        startsAt: '2026-08-03T20:00:00Z',
        status: 'active',
        title: 'Server past quiz',
      },
      {
        endsAt: '2026-08-03T21:05:00Z',
        id: 'event-server-active',
        prizeName: 'Tablet',
        questionCount: 5,
        serverNow: '2026-08-03T20:10:00Z',
        startsAt: '2026-08-03T20:00:00Z',
        status: 'active',
        title: 'Server active quiz',
      },
    ]);

    render(<QuizLeaderboardScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', {
        name: 'View leaderboard for Server past quiz',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'View leaderboard for Server active quiz',
      })
    ).toBeNull();
    jest.useRealTimers();
  });

  it('hides finalizing quizzes until final standings are published', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2026-08-03T20:05:00Z',
        id: 'event-finalizing',
        prizeName: 'Phone',
        questionCount: 20,
        resultsPublishedAt: null,
        startsAt: '2026-08-03T20:00:00Z',
        status: 'finalizing',
        title: 'Still finalizing',
      },
      {
        endsAt: '2026-08-02T20:05:00Z',
        id: 'event-published',
        prizeName: 'Tablet',
        questionCount: 5,
        resultsPublishedAt: '2026-08-02T20:06:00Z',
        startsAt: '2026-08-02T20:00:00Z',
        status: 'finalizing',
        title: 'Published finalizing quiz',
      },
    ]);

    render(<QuizLeaderboardScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByRole('button', {
        name: 'View leaderboard for Still finalizing',
      })
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'View leaderboard for Published finalizing quiz',
      })
    ).toBeTruthy();
  });
});
