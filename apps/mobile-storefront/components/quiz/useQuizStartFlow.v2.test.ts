import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { QuizIntegrityTier, QuizV2Attempt } from '@/services/quiz-types';
import { QuizServiceError } from '@/services/quiz-types';
import { useQuizStartFlow } from './useQuizStartFlow';

const mockReopenForCorrection = jest.fn();
const mockDobRequestStart = jest.fn();
const mockUsernameRequestStart = jest.fn();
const mockStartQuizAttempt = jest.fn<(args: unknown) => Promise<unknown>>();
const mockStartQuizAttemptV2 = jest.fn<(args: unknown) => Promise<unknown>>();
const mockGetFingerprint = jest.fn<() => Promise<string | null>>();

// Captured so the test can drive the gate callbacks the flow wires up.
let dobOnStart: (eventId: string) => void = () => {};
let _usernameOnStart: (eventId: string) => void = () => {};
// The currently signed-in shopper; tests mutate it to simulate an account
// switch while a start request is in flight.
let mockAuthUserId: string | null = 'user-a';

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: () => mockGetFingerprint(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
  },
}));

jest.mock('@/services/quiz', () => ({
  startQuizAttempt: (args: unknown) => mockStartQuizAttempt(args),
}));
jest.mock('@/services/quiz-attempts', () => ({
  createQuizStartRequestId: () => 'start-request-1',
  startQuizAttemptV2: (args: unknown) => mockStartQuizAttemptV2(args),
}));

jest.mock('./useQuizDateOfBirthGate', () => ({
  useQuizDateOfBirthGate: (onStart: (eventId: string) => void) => {
    dobOnStart = onStart;
    return {
      cancelGate: jest.fn(),
      confirmGate: jest.fn(),
      correctionError: null,
      generation: 0,
      isGateVisible: false,
      reopenForCorrection: mockReopenForCorrection,
      requestStart: mockDobRequestStart,
    };
  },
}));

jest.mock('./useQuizStartGate', () => ({
  useQuizStartGate: (onStart: (eventId: string) => void) => {
    _usernameOnStart = onStart;
    return {
      cancelGate: jest.fn(),
      confirmGate: jest.fn(),
      isGateVisible: false,
      requestStart: mockUsernameRequestStart,
    };
  },
}));

// Mirrors the store: run the starter and swallow its failure into store state.
const startEvent = jest.fn(
  async (_eventId: string, _tier: string, starter: () => Promise<unknown>) => {
    await starter().catch(() => {});
  }
);

describe('useQuizStartFlow v2 contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = 'user-a';
    mockGetFingerprint.mockImplementation(async () => 'fp');
    mockStartQuizAttempt.mockResolvedValue({ attemptId: 'attempt-1' });
    mockStartQuizAttemptV2.mockResolvedValue({ attemptId: 'attempt-v2' });
  });
  it('keeps terminal recovery dismissed until the v2 start transition settles', async () => {
    let releaseStart!: () => void;
    const onStartSettled = jest.fn();
    const startEventV2 = jest.fn(
      async (
        _context: unknown,
        starter: (startRequestId: string) => Promise<QuizV2Attempt>
      ) => {
        await new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        await starter('start-request-1');
      }
    );
    const { result } = renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2-race',
            mode: 'test',
            prizeName: 'Phone',
            questionCount: 1,
            rulesVersion: 'quiz-rules-2026-08',
            startsAt: '2026-08-03T20:00:00Z',
            status: 'active',
            title: 'Retry race',
          },
        ],
        integrityTier: 'device',
        onStartSettled,
        startEvent,
        startEventV2,
      })
    );

    act(() => result.current.requestStart('event-v2-race', true));
    dobOnStart('event-v2-race');
    await waitFor(() => expect(startEventV2).toHaveBeenCalledTimes(1));
    expect(onStartSettled).not.toHaveBeenCalled();

    await act(async () => {
      releaseStart();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(onStartSettled).toHaveBeenCalledWith('event-v2-race')
    );
  });

  it('reopens the DOB gate when a v2 start rejects the stored date of birth', async () => {
    mockStartQuizAttemptV2.mockRejectedValueOnce(
      new QuizServiceError(
        'Quiz participation requires an adult profile (18+)',
        'quiz_age_restricted',
        403
      )
    );
    const startEventV2 = jest.fn(
      async (
        _context: unknown,
        starter: (startRequestId: string) => Promise<QuizV2Attempt>
      ) => {
        await starter('start-request-1').catch(() => undefined);
      }
    );
    const { result } = renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2-age',
            mode: 'test',
            prizeName: 'Phone',
            questionCount: 3,
            rulesVersion: 'quiz-rules-2026-08',
            startsAt: '2026-08-03T20:00:00Z',
            status: 'active',
            title: 'V2 age gate',
          },
        ],
        integrityTier: 'device',
        startEvent,
        startEventV2,
      })
    );

    act(() => result.current.requestStart('event-v2-age', true));
    dobOnStart('event-v2-age');
    await waitFor(() =>
      expect(mockReopenForCorrection).toHaveBeenCalledWith(
        'event-v2-age',
        'Quiz participation requires an adult profile (18+)'
      )
    );
  });

  it('reports the standard session-changed error when v2 identity changes during fingerprint lookup', async () => {
    let capturedError: unknown;
    const startEventV2 = jest.fn(
      async (
        _context: {
          eventId: string;
          integrityTier: QuizIntegrityTier;
          startRequestId: string;
          userId: string | null;
        },
        starter: (startRequestId: string) => Promise<QuizV2Attempt>
      ) => {
        try {
          await starter('start-request-1');
        } catch (error) {
          capturedError = error;
        }
      }
    );
    mockGetFingerprint.mockImplementationOnce(async () => {
      mockAuthUserId = 'user-b';
      return 'fp';
    });
    const { result } = renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2',
            mode: 'test',
            prizeName: 'Phone',
            questionCount: 20,
            rulesVersion: 'quiz-rules-2026-08',
            startsAt: '2026-08-03T20:00:00Z',
            status: 'active',
            title: 'Live quiz',
          },
        ],
        integrityTier: 'device',
        startEvent,
        startEventV2,
      })
    );

    act(() => result.current.requestStart('event-v2', true));
    dobOnStart('event-v2');

    await waitFor(() => expect(capturedError).toBeInstanceOf(QuizServiceError));
    expect(capturedError).toMatchObject({
      code: 'quiz_session_changed',
      message: 'Your session changed. Please try again.',
      status: 409,
    });
    expect(mockStartQuizAttemptV2).not.toHaveBeenCalled();
  });

  it('fails closed through the v2 action when the session is missing', async () => {
    mockAuthUserId = null;
    let capturedError: unknown;
    const startEventV2 = jest.fn(
      async (
        _context: unknown,
        starter: (startRequestId: string) => Promise<QuizV2Attempt>
      ) => {
        try {
          await starter('start-request-1');
        } catch (error) {
          capturedError = error;
        }
      }
    );
    const { result } = renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2-missing-user',
            mode: 'test',
            prizeName: 'Phone',
            questionCount: 20,
            rulesVersion: 'quiz-rules-2026-08',
            startsAt: '2026-08-03T20:00:00Z',
            status: 'active',
            title: 'Live quiz',
          },
        ],
        integrityTier: 'device',
        startEvent,
        startEventV2,
      })
    );

    act(() => result.current.requestStart('event-v2-missing-user', true));
    dobOnStart('event-v2-missing-user');

    await waitFor(() => expect(startEventV2).toHaveBeenCalled());
    expect(capturedError).toMatchObject({
      code: 'quiz_session_changed',
      status: 409,
    });
    expect(mockStartQuizAttemptV2).not.toHaveBeenCalled();
  });
});
