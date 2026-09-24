import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { fetchQuizEvents } from '@/services/quiz';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { QuizLeaderboardScreen } from './QuizLeaderboardScreen';

jest.mock('@/services/quiz', () => ({ fetchQuizEvents: jest.fn() }));
jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'customer-1' } }),
}));

describe('QuizLeaderboardScreen', () => {
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

  it('hides non-terminal events even when the device clock is ahead', async () => {
    jest.mocked(fetchQuizEvents).mockResolvedValue([
      {
        endsAt: '2020-01-01T00:00:00Z',
        id: 'event-live',
        prizeName: 'Phone',
        questionCount: 20,
        startsAt: '2019-12-31T23:00:00Z',
        status: 'active',
        title: 'Live quiz',
      },
    ]);

    render(<QuizLeaderboardScreen />);
    await screen.findByText('No previous quiz leaderboards yet.');

    expect(screen.queryByText('Live quiz')).toBeNull();
  });

  it('shows an accessible error when history cannot load', async () => {
    jest.mocked(fetchQuizEvents).mockRejectedValue(new Error('offline'));
    render(<QuizLeaderboardScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Past leaderboards are unavailable.'
    );
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
      status: 'ranked',
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
});
