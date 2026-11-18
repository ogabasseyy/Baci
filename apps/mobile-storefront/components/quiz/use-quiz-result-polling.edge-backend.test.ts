import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createElement } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchQuizEvents } from '@/services/quiz';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizEvent, QuizV2Attempt } from '@/services/quiz-types';
import type { loadQuizRecoveryEnvelopes } from '@/stores/quiz-recovery-envelope';
import { useQuizStore } from '@/stores/quiz-store';
import { QuizScreen } from './QuizScreen';
import type { QuizScreenProps } from './QuizScreen.types';
import { useQuizResultPolling } from './use-quiz-result-polling';

const mockSetAuth = jest.fn<() => Promise<void>>();
const mockSubscribe = jest.fn();
const mockOn = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockRealtimeChannel = {
  on: mockOn,
  subscribe: mockSubscribe,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (...args: unknown[]) => mockChannel(...args),
    realtime: { setAuth: () => mockSetAuth() },
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

let mockAuthUserId: string | null = 'quiz-shopper';
let mockPersistedEnvelopes: Awaited<
  ReturnType<typeof loadQuizRecoveryEnvelopes>
> = [];

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
  getQuizDeviceFingerprint: jest.fn(async () => 'f'.repeat(64)),
}));

jest.mock('@/services/quiz', () => ({
  fetchQuizEvents: jest.fn(),
  submitQuizAnswer: jest.fn(),
}));

jest.mock('@/services/quiz-attempts', () => ({
  createQuizStartRequestId: jest.fn(
    () => '11111111-1111-4111-8111-111111111111'
  ),
  startQuizAttemptV2: jest.fn(),
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

jest.mock('@/stores/quiz-recovery-envelope', () => {
  const actual = jest.requireActual(
    '@/stores/quiz-recovery-envelope'
  ) as typeof import('@/stores/quiz-recovery-envelope');
  return {
    ...actual,
    clearQuizRecoveryEnvelope: jest.fn(async () => undefined),
    loadQuizRecoveryEnvelope: jest.fn(async () => null),
    loadQuizRecoveryEnvelopes: jest.fn(async () => mockPersistedEnvelopes),
    saveQuizRecoveryEnvelope: jest.fn(async () => undefined),
  };
});

jest.mock('expo-image', () => ({ Image: 'Image' }));

jest.mock('./QuizGameplayAdFooter', () => ({
  QuizGameplayAdFooter: () => null,
}));

jest.mock('./QuizMusicPlayer', () => ({
  QuizMusicPlayer: () => null,
}));

jest.mock('./QuizScreenModals', () => ({
  QuizScreenModals: () => null,
}));

jest.mock('./useQuizStartFlow', () => ({
  useQuizStartFlow: () => ({
    adsPrewarmFailed: false,
    dobGate: { isGateVisible: false },
    requestStart: jest.fn(),
    usernameGate: {},
  }),
}));

const makeEvent = (
  id: string,
  backendMode: QuizEvent['backendMode']
): QuizEvent => ({
  backendMode,
  contractVersion: 2,
  endsAt: '2026-11-18T18:00:00.000Z',
  id,
  liveWindowSeconds: 600,
  maxAttempts: 1,
  maximumPlaySeconds: 100,
  mode: 'live',
  prizeName: 'iPhone 17 Pro',
  questionCount: 10,
  resultsPublishedAt: null,
  rulesVersion: '2026-11',
  serverNow: '2026-11-18T17:50:00.000Z',
  startsAt: '2026-11-18T17:50:00.000Z',
  status: 'active',
  timePerQuestionSeconds: 10,
  timeZone: 'Africa/Lagos',
  title: 'SuperQuiz',
});

const finalResultPayload = {
  attemptId: 'attempt-edge-1',
  availability: 'final' as const,
  availableAt: '2026-11-18T18:00:30.000Z',
  rank: 2,
  score: 9,
  totalQuestions: 10,
};

const publishedLeaderboardPayload = {
  currentPlayer: {
    displayName: 'lagos_fast',
    isCurrentCustomer: true,
    rank: 2,
    score: 9,
    status: 'completed',
    submittedAt: '2026-11-18T17:52:00.000Z',
    totalTimeSeconds: 24.5,
  },
  entries: [],
  participantCount: 100,
  status: 'published' as const,
};

describe('Stage 1 Test 3: edge_rooms mobile Realtime suppression', () => {
  let appStateListeners: Array<(state: AppStateStatus) => void>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(fetchQuizEvents).mockReset();
    jest.mocked(fetchQuizResult).mockReset();
    jest.mocked(fetchQuizLeaderboard).mockReset();
    jest.mocked(submitQuizAnswerV2).mockReset();
    jest.mocked(recoverActiveQuizAttempt).mockReset();
    useQuizStore.getState().reset();
    mockAuthUserId = 'quiz-shopper';
    mockPersistedEnvelopes = [];
    appStateListeners = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        appStateListeners.push(listener);
        return { remove: jest.fn() };
      });
    mockSetAuth.mockRejectedValue(
      new Error('Realtime unavailable in edge_rooms test')
    );
    mockChannel.mockReturnValue(mockRealtimeChannel);
    mockOn.mockReturnValue(mockRealtimeChannel);
    mockSubscribe.mockReturnValue(mockRealtimeChannel);
    jest
      .mocked(fetchQuizLeaderboard)
      .mockResolvedValue(publishedLeaderboardPayload);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('skips quiz-results channel joins for edge_rooms and delivers final results via HTTP polling with Realtime unavailable', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const onResult = jest.fn();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-edge-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce(finalResultPayload);

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-edge-1',
        backendMode: 'edge_rooms',
        enabled: true,
        eventId: 'event-edge-1',
        expectedUserId: 'quiz-shopper',
        onResult,
      })
    );

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ availability: 'pending' })
      )
    );
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(onResult).toHaveBeenLastCalledWith(finalResultPayload);
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it('keeps zero channel joins on AppState reconnect for edge_rooms and polls immediately on foreground', async () => {
    const onResult = jest.fn();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-edge-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce(finalResultPayload);

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-edge-1',
        backendMode: 'edge_rooms',
        enabled: true,
        eventId: 'event-edge-1',
        expectedUserId: 'quiz-shopper',
        onResult,
      })
    );

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    act(() => appStateListeners.at(-1)?.('background'));
    await act(async () => {
      appStateListeners.at(-1)?.('active');
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onResult).toHaveBeenLastCalledWith(finalResultPayload)
    );
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it('retains quiz-results channel join and broadcast wakeup for postgres events', async () => {
    mockSetAuth.mockResolvedValue();
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-pg-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce({
        ...finalResultPayload,
        attemptId: 'attempt-pg-1',
      });
    const onResult = jest.fn();

    renderHook(() =>
      useQuizResultPolling({
        attemptId: 'attempt-pg-1',
        backendMode: 'postgres',
        enabled: true,
        eventId: 'event-pg-1',
        expectedUserId: 'quiz-shopper',
        onResult,
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockChannel).toHaveBeenCalledWith('quiz-results:event-pg-1', {
      config: { private: true },
    });
    expect(mockSetAuth).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    const broadcastHandler = mockOn.mock.calls[0]?.[2] as
      | (() => void)
      | undefined;
    expect(broadcastHandler).toEqual(expect.any(Function));

    jest.spyOn(Math, 'random').mockReturnValue(0);
    await act(async () => {
      broadcastHandler?.();
      await jest.advanceTimersByTimeAsync(0);
    });

    await waitFor(() =>
      expect(onResult).toHaveBeenLastCalledWith(
        expect.objectContaining({
          attemptId: 'attempt-pg-1',
          availability: 'final',
        })
      )
    );
  });

  it('suppresses quiz-results channel across normal play -> pending_results -> final in QuizScreen for edge_rooms', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const edgeEvent = makeEvent('event-edge-play', 'edge_rooms');
    jest.mocked(fetchQuizEvents).mockResolvedValue([edgeEvent]);
    const activeAttempt: QuizV2Attempt = {
      attemptId: 'attempt-edge-1',
      backendMode: 'edge_rooms',
      eventEndsAt: '2026-11-18T18:00:00.000Z',
      eventId: 'event-edge-play',
      question: {
        deadlineAt: '2026-11-18T17:50:10.000Z',
        id: 'q-10',
        index: 10,
        options: [{ id: 'opt-a', label: 'Lagos' }],
        prompt: 'Final question?',
        timeLimitSeconds: 10,
        total: 10,
      },
      resultsAvailableAt: '2026-11-18T18:00:30.000Z',
      serverNow: '2026-11-18T17:50:00.000Z',
      status: 'in_progress',
    };
    jest.mocked(submitQuizAnswerV2).mockResolvedValue({
      attemptId: 'attempt-edge-1',
      backendMode: 'edge_rooms',
      eventEndsAt: '2026-11-18T18:00:00.000Z',
      eventId: 'event-edge-play',
      resultsAvailableAt: null,
      serverNow: '2026-11-18T17:52:00.000Z',
      status: 'submitted_pending_results',
      submittedAt: '2026-11-18T17:52:00.000Z',
    });
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-edge-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce(finalResultPayload);

    useQuizStore.setState({
      events: [edgeEvent],
      selectedEventId: edgeEvent.id,
      status: 'question',
      v2Attempt: activeAttempt,
      v2LifecycleStatus: 'in_progress',
    });

    render(
      createElement<QuizScreenProps>(QuizScreen, { integrityTier: 'device' })
    );
    expect(mockChannel).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByText('Lagos'));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(useQuizStore.getState().v2LifecycleStatus).toBe('pending_results')
    );
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(await screen.findByText('You placed #2')).toBeTruthy();
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it('suppresses quiz-results channel on resume and AppState reconnect for edge_rooms while HTTP polling recovers final result', async () => {
    const edgeEvent = makeEvent('event-edge-resume', 'edge_rooms');
    jest.mocked(fetchQuizEvents).mockResolvedValue([edgeEvent]);
    mockPersistedEnvelopes = [
      {
        attemptId: 'attempt-edge-1',
        currentQuestionId: null,
        eventId: 'event-edge-resume',
        generation: 1,
        pendingLockedOptionId: null,
        persistedAt: '2026-11-18T17:52:00.000Z',
        startRequestId: '11111111-1111-4111-8111-111111111111',
        submittedAt: '2026-11-18T17:52:00.000Z',
        userId: 'quiz-shopper',
        version: 1,
      },
    ];
    jest.mocked(recoverActiveQuizAttempt).mockResolvedValue({
      attemptId: 'attempt-edge-1',
      availability: 'pending_results',
      eventEndsAt: '2026-11-18T18:00:00.000Z',
      serverNow: '2026-11-18T17:55:00.000Z',
      submittedAt: '2026-11-18T17:52:00.000Z',
    });
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-edge-1',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce(finalResultPayload);

    render(
      createElement<QuizScreenProps>(QuizScreen, { integrityTier: 'device' })
    );

    await waitFor(() =>
      expect(useQuizStore.getState().v2LifecycleStatus).toBe('pending_results')
    );
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();

    act(() => {
      for (const listener of appStateListeners) listener('background');
    });
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(await screen.findByText('You placed #2')).toBeTruthy();
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it('retains quiz-results Realtime channel in QuizScreen for postgres events', async () => {
    mockSetAuth.mockResolvedValue();
    const pgEvent = makeEvent('event-pg-screen', 'postgres');
    jest
      .mocked(fetchQuizResult)
      .mockResolvedValueOnce({
        attemptId: 'attempt-pg-screen',
        availability: 'pending',
        availableAt: null,
      })
      .mockResolvedValueOnce({
        ...finalResultPayload,
        attemptId: 'attempt-pg-screen',
      });

    useQuizStore.setState({
      events: [pgEvent],
      selectedEventId: pgEvent.id,
      status: 'result',
      terminalContext: {
        attemptId: 'attempt-pg-screen',
        contractVersion: 2,
        eventId: pgEvent.id,
      },
      v2LifecycleStatus: 'pending_results',
      v2Result: null,
    });

    render(
      createElement<QuizScreenProps>(QuizScreen, { integrityTier: 'device' })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockChannel).toHaveBeenCalledWith('quiz-results:event-pg-screen', {
      config: { private: true },
    });
    expect(mockSetAuth).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });
});
