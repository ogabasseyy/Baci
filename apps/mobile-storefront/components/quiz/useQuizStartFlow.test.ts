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
let usernameOnStart: (eventId: string) => void = () => {};
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
    usernameOnStart = onStart;
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

describe('useQuizStartFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = 'user-a';
    mockGetFingerprint.mockImplementation(async () => 'fp');
    mockStartQuizAttempt.mockResolvedValue({ attemptId: 'attempt-1' });
    mockStartQuizAttemptV2.mockResolvedValue({ attemptId: 'attempt-v2' });
  });

  it('hands the username gate off to the date-of-birth gate', () => {
    renderHook(() => useQuizStartFlow({ integrityTier: 'device', startEvent }));

    usernameOnStart('event-1');

    expect(mockDobRequestStart).toHaveBeenCalledWith('event-1');
  });

  it('reopens the date-of-birth gate when the server rejects a stored DOB as under-18', async () => {
    mockStartQuizAttempt.mockRejectedValueOnce(
      new QuizServiceError(
        'Quiz participation requires an adult profile (18+)',
        'quiz_age_restricted',
        403
      )
    );
    renderHook(() => useQuizStartFlow({ integrityTier: 'device', startEvent }));

    dobOnStart('event-1');

    await waitFor(() =>
      expect(mockReopenForCorrection).toHaveBeenCalledWith(
        'event-1',
        'Quiz participation requires an adult profile (18+)'
      )
    );
  });

  it('does not reopen the gate for a non-age start failure', async () => {
    mockStartQuizAttempt.mockRejectedValueOnce(
      new QuizServiceError('Server error', 'QUIZ_REQUEST_FAILED', 500)
    );
    renderHook(() => useQuizStartFlow({ integrityTier: 'device', startEvent }));

    dobOnStart('event-1');

    await waitFor(() => expect(mockStartQuizAttempt).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockReopenForCorrection).not.toHaveBeenCalled();
  });

  it('does not reopen the gate when the account switched mid-request', async () => {
    // The signed-in shopper changes while the start is in flight; the stale
    // age-rejection must not open the old event under the new session.
    mockStartQuizAttempt.mockImplementationOnce(async () => {
      mockAuthUserId = 'user-b';
      throw new QuizServiceError(
        'Quiz participation requires an adult profile (18+)',
        'quiz_age_restricted',
        403
      );
    });
    renderHook(() => useQuizStartFlow({ integrityTier: 'device', startEvent }));

    dobOnStart('event-1');

    await waitFor(() => expect(mockStartQuizAttempt).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockReopenForCorrection).not.toHaveBeenCalled();
  });

  it('does not start when the account switches during the fingerprint lookup', async () => {
    // The shopper signs out / switches while getQuizDeviceFingerprint is
    // resolving; the request must not be issued under the new session.
    mockGetFingerprint.mockImplementationOnce(async () => {
      mockAuthUserId = 'user-b';
      return 'fp';
    });
    renderHook(() => useQuizStartFlow({ integrityTier: 'device', startEvent }));

    dobOnStart('event-1');

    await waitFor(() => expect(mockGetFingerprint).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockStartQuizAttempt).not.toHaveBeenCalled();
    expect(mockReopenForCorrection).not.toHaveBeenCalled();
  });

  it('starts contract v2 with accepted rules and a stable start request', async () => {
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
        await starter('start-request-1');
      }
    );
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

    await waitFor(() => expect(mockStartQuizAttemptV2).toHaveBeenCalled());
    expect(startEventV2).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-v2',
        startRequestId: 'start-request-1',
        userId: 'user-a',
      }),
      expect.any(Function)
    );
    expect(mockStartQuizAttemptV2).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedRulesVersion: 'quiz-rules-2026-08',
        mode: 'test',
        startRequestId: 'start-request-1',
        termsAccepted: true,
      })
    );
  });
});
