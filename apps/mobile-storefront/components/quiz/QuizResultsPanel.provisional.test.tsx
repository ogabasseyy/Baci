import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { QuizResultsPanel } from './QuizResultsPanel';
import { createQuizStyles } from './QuizScreen.styles';
import { useQuizResultsLeaderboard } from './use-quiz-results-leaderboard';

jest.mock('./use-quiz-results-leaderboard', () => ({
  useQuizResultsLeaderboard: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));
jest.mock('./QuizPrizeClaimPanel', () => ({ QuizPrizeClaimPanel: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const colors = {
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
const currentPlayer = {
  displayName: 'Me',
  isCurrentCustomer: true,
  rank: 2,
  score: 4,
  status: 'submitted',
  submittedAt: null,
  totalTimeSeconds: 10,
};
const pending = {
  attemptId: 'attempt-1',
  availability: 'pending' as const,
  availableAt: null,
};
const props = {
  eventId: 'event-1',
  expectedUserId: 'user-1',
  legacyResult: null,
  lifecycle: 'pending_results' as const,
  styles: createQuizStyles(colors),
  v2Result: pending,
};

describe('provisional quiz score', () => {
  beforeEach(() => {
    jest.mocked(useQuizResultsLeaderboard).mockReturnValue({
      leaderboard: {
        currentPlayer,
        entries: [{ ...currentPlayer, displayName: 'Other', rank: 1 }],
        participantCount: 2,
        status: 'live',
      },
      leaderboardError: false,
      participantCount: 2,
    });
  });
  it('shows only the authenticated personal provisional best score', () => {
    render(<QuizResultsPanel {...props} />);
    expect(screen.getByText('Provisional best score')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
    expect(screen.queryByText('#2')).toBeNull();
    expect(
      jest.mocked(useQuizResultsLeaderboard).mock.lastCall?.[0].enabled
    ).toBe(true);
  });
  it('suppresses scores for revoked attempts and non-finite values', () => {
    jest.mocked(useQuizResultsLeaderboard).mockReturnValue({
      leaderboard: {
        currentPlayer: { ...currentPlayer, score: Number.NaN },
        entries: [],
        participantCount: 1,
        status: 'live',
      },
      leaderboardError: false,
      participantCount: 1,
    });
    const view = render(<QuizResultsPanel {...props} />);
    expect(screen.queryByText('Provisional best score')).toBeNull();
    jest.mocked(useQuizResultsLeaderboard).mockReturnValue({
      leaderboard: {
        currentPlayer,
        entries: [],
        participantCount: 1,
        status: 'live',
      },
      leaderboardError: false,
      participantCount: 1,
    });
    view.rerender(
      <QuizResultsPanel
        {...props}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'unavailable',
          reason: 'tester_revoked',
        }}
      />
    );
    expect(screen.queryByText('Provisional best score')).toBeNull();
  });

  it('uses the published final score when it differs from the live best', () => {
    render(
      <QuizResultsPanel
        {...props}
        lifecycle="final"
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'final',
          availableAt: '2026-01-01T00:00:00Z',
          rank: 3,
          score: 7,
          totalQuestions: 10,
        }}
      />
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.queryByText('Provisional best score')).toBeNull();
  });

  it('omits a missing current player even when entries exist', () => {
    jest.mocked(useQuizResultsLeaderboard).mockReturnValue({
      leaderboard: {
        currentPlayer: null,
        entries: [currentPlayer],
        participantCount: 1,
        status: 'live',
      },
      leaderboardError: false,
      participantCount: 1,
    });
    render(<QuizResultsPanel {...props} />);
    expect(screen.queryByText('Provisional best score')).toBeNull();
  });
});
