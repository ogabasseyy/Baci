import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { QuizScreen } from '@/components/quiz/QuizScreen';
import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizResult } from '@/services/quiz-results';
import { useQuizStore } from '@/stores/quiz-store';

let mockAuthUserId: string | null = 'quiz-shopper';
const mockQuizResultsWakeup = { current: null as (() => void) | null };

jest.mock('./use-quiz-result-realtime-wakeup', () => {
  return {
    useQuizResultRealtimeWakeup: ({
      enabled,
      onWakeup,
    }: {
      enabled: boolean;
      onWakeup: () => void;
    }) => {
      mockQuizResultsWakeup.current = enabled ? onWakeup : null;
    },
  };
});

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
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
    },
    isDark: true,
    shadows: {},
  }),
}));
jest.mock('@/stores/auth-store', () => {
  const getState = () => ({
    user: mockAuthUserId ? { id: mockAuthUserId } : null,
  });
  const useAuthStore = (
    selector: (state: ReturnType<typeof getState>) => unknown
  ) => selector(getState());
  useAuthStore.getState = getState;
  return { useAuthStore };
});
jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: jest.fn(async () => 'a'.repeat(64)),
}));
jest.mock('@/services/quiz', () => ({ fetchQuizEvents: jest.fn() }));
jest.mock('@/services/quiz-attempts', () => ({
  submitQuizAnswerV2: jest.fn(),
}));
jest.mock('@/services/quiz-attempt-recovery', () => ({
  recoverActiveQuizAttempt: jest.fn(),
}));
jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
jest.mock('@/services/quiz-results', () => ({
  fetchQuizResult: jest.fn(),
}));
jest.mock('./QuizGameplayAdFooter', () => ({
  QuizGameplayAdFooter: () => null,
}));
jest.mock('./QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => {
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return <Text>Quiz music is playing</Text>;
  },
}));
jest.mock('./QuizScreenModals', () => ({ QuizScreenModals: () => null }));
jest.mock('./useQuizPersistedRecovery', () => ({
  useQuizPersistedRecovery: () => ({ retryRecovery: jest.fn() }),
}));
jest.mock('./useQuizStartFlow', () => ({
  useQuizStartFlow: () => ({
    adsPrewarmFailed: false,
    dobGate: {},
    requestStart: jest.fn(),
    usernameGate: {},
  }),
}));

describe('QuizScreen result and universal-expiry lifecycle', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
    mockAuthUserId = 'quiz-shopper';
    mockQuizResultsWakeup.current = null;
    jest.clearAllMocks();
    jest.mocked(fetchQuizResult).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens final results when the publication wakeup arrives', async () => {
    jest.useFakeTimers();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-v2',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt-v2',
        availability: 'final',
        availableAt: '2026-08-09T20:26:20.000Z',
        rank: 1,
        score: 4,
        totalQuestions: 5,
      });
    jest.mocked(fetchQuizLeaderboard).mockResolvedValue({
      currentPlayer: {
        displayName: 'ogafan',
        isCurrentCustomer: true,
        rank: 1,
        score: 4,
        status: 'completed',
        submittedAt: '2026-08-09T20:26:10.000Z',
        totalTimeSeconds: 38,
      },
      entries: [],
      participantCount: 1,
      status: 'published',
    });
    useQuizStore.setState({
      status: 'result',
      terminalContext: {
        attemptId: 'attempt-v2',
        contractVersion: 2,
        eventId: 'event-v2',
      },
      v2LifecycleStatus: 'pending_results',
      v2Result: null,
    });

    render(<QuizScreen integrityTier="device" />);
    expect(screen.getByText('Quiz music is playing')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchQuizResult).toHaveBeenCalledTimes(1);

    expect(mockQuizResultsWakeup.current).toEqual(expect.any(Function));
    await act(async () => {
      mockQuizResultsWakeup.current?.();
      await Promise.resolve();
    });

    expect(await screen.findByText('You placed #1')).toBeTruthy();
    expect(screen.getByLabelText('Rank 1, ogafan, score 4')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Final standings')).toBeTruthy();
    expect(screen.getByText(/ogafan/)).toBeTruthy();
    expect(fetchQuizLeaderboard).toHaveBeenCalledWith({
      eventId: 'event-v2',
      expectedUserId: 'quiz-shopper',
    });
    expect(
      screen.getByRole('button', { name: 'View past quiz leaderboards' })
    ).toBeTruthy();
  });

  it('requests recovery when the universal event deadline expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const activeAttempt = {
      attemptId: 'attempt-v2',
      eventEndsAt: new Date(1_000).toISOString(),
      eventId: 'event-v2',
      question: {
        deadlineAt: new Date(20_000).toISOString(),
        id: 'question-v2',
        index: 1,
        options: [{ id: 'answer-v2', label: 'Abuja' }],
        prompt: 'Capital of Nigeria?',
        timeLimitSeconds: 20,
        total: 3,
      },
      resultsAvailableAt: null,
      serverNow: new Date(0).toISOString(),
      status: 'in_progress' as const,
    };
    useQuizStore.setState({
      lockedOptionId: null,
      status: 'question',
      v2Attempt: activeAttempt,
    });
    jest.mocked(recoverActiveQuizAttempt).mockResolvedValue({
      availability: 'pending_results',
      eventEndsAt: activeAttempt.eventEndsAt,
      serverNow: new Date(1_000).toISOString(),
    });
    jest.mocked(fetchQuizResult).mockResolvedValue({
      attemptId: 'attempt-v2',
      availability: 'pending',
      availableAt: activeAttempt.eventEndsAt,
    });

    render(<QuizScreen integrityTier="device" />);
    await act(async () => {
      jest.advanceTimersByTime(1_250);
      await Promise.resolve();
    });

    expect(recoverActiveQuizAttempt).toHaveBeenCalledTimes(1);
    expect(recoverActiveQuizAttempt).toHaveBeenCalledWith({
      deviceFingerprint: 'a'.repeat(64),
      eventId: 'event-v2',
      expectedUserId: 'quiz-shopper',
    });
    expect(useQuizStore.getState().v2LifecycleStatus).toBe('pending_results');
    expect(useQuizStore.getState().v2Attempt).toBeNull();
    expect(getQuizDeviceFingerprint).toHaveBeenCalledTimes(1);
  });
});
