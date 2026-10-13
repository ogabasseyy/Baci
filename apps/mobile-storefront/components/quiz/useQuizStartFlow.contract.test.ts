import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { QuizV2Attempt } from '@/services/quiz-types';
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

describe('useQuizStartFlow contract validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = 'user-a';
    mockGetFingerprint.mockImplementation(async () => 'fp');
    mockStartQuizAttempt.mockResolvedValue({ attemptId: 'attempt-1' });
    mockStartQuizAttemptV2.mockResolvedValue({ attemptId: 'attempt-v2' });
  });
  it('does not fall back to the legacy endpoint when a v2 action is unavailable', async () => {
    let capturedError: unknown;
    const captureStartEvent = jest.fn(
      async (
        _eventId: string,
        _tier: string,
        starter: () => Promise<unknown>
      ) => {
        try {
          await starter();
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
            id: 'event-v2-no-action',
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
        startEvent: captureStartEvent,
      })
    );

    act(() => result.current.requestStart('event-v2-no-action', true));
    dobOnStart('event-v2-no-action');

    await waitFor(() => expect(captureStartEvent).toHaveBeenCalled());
    expect(capturedError).toMatchObject({
      code: 'QUIZ_CONTRACT_UNSUPPORTED',
      status: 409,
    });
    expect(mockStartQuizAttempt).not.toHaveBeenCalled();
  });

  it('requires recorded terms before calling the v2 start API', async () => {
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
    renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2-terms',
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

    dobOnStart('event-v2-terms');
    await waitFor(() => expect(startEventV2).toHaveBeenCalled());
    expect(capturedError).toMatchObject({
      code: 'QUIZ_TERMS_ACCEPTANCE_REQUIRED',
      status: 409,
    });
    expect(mockStartQuizAttemptV2).not.toHaveBeenCalled();
  });

  it('requires the declared v2 rules version and mode instead of defaulting them', async () => {
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
            id: 'event-v2-incomplete',
            prizeName: 'Phone',
            questionCount: 20,
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

    act(() => result.current.requestStart('event-v2-incomplete', true));
    dobOnStart('event-v2-incomplete');

    await waitFor(() => expect(startEventV2).toHaveBeenCalled());
    expect(capturedError).toMatchObject({
      code: 'QUIZ_CONTRACT_INVALID',
      status: 502,
    });
    expect(mockStartQuizAttemptV2).not.toHaveBeenCalled();
  });
});
