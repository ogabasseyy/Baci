import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { QuizIntegrityTier, QuizV2Attempt } from '@/services/quiz-types';
import { useQuizStartFlow } from './useQuizStartFlow';

const mockDobRequestStart = jest.fn();
const mockStartQuizAttempt = jest.fn<(args: unknown) => Promise<unknown>>();
const mockStartQuizAttemptV2 = jest.fn<(args: unknown) => Promise<unknown>>();
const mockGetFingerprint = jest.fn<() => Promise<string | null>>();
let dobOnStart: (eventId: string) => void = () => {};
let mockAuthUserId: string | null = 'user-a';
let mockDateOfBirth: string | null = null;

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: () => mockGetFingerprint(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      customer: mockDateOfBirth ? { date_of_birth: mockDateOfBirth } : null,
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
      reopenForCorrection: jest.fn(),
      requestStart: mockDobRequestStart,
    };
  },
}));
jest.mock('./useQuizStartGate', () => ({
  useQuizStartGate: () => ({
    cancelGate: jest.fn(),
    confirmGate: jest.fn(),
    isGateVisible: false,
    requestStart: jest.fn(),
  }),
}));

const startEvent = jest.fn(
  async (_eventId: string, _tier: string, starter: () => Promise<unknown>) => {
    await starter().catch(() => {});
  }
);

describe('useQuizStartFlow mobile-ad prewarm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = 'user-a';
    mockDateOfBirth = null;
    mockGetFingerprint.mockResolvedValue('fp');
    mockStartQuizAttempt.mockResolvedValue({ attemptId: 'attempt-1' });
    mockStartQuizAttemptV2.mockResolvedValue({ attemptId: 'attempt-v2' });
  });

  it('prepares optional mobile ads before starting the timed attempt', async () => {
    let resolvePreparation!: () => void;
    const prepareQuizMobileAds = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePreparation = () => resolve(true);
        })
    );
    const { result } = renderHook(() =>
      useQuizStartFlow({
        integrityTier: 'device',
        prepareQuizMobileAds,
        startEvent,
      })
    );

    act(() => result.current.requestStart('event-1'));
    dobOnStart('event-1');
    await waitFor(() => expect(prepareQuizMobileAds).toHaveBeenCalledTimes(1));
    expect(startEvent).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreparation();
      await Promise.resolve();
    });
    await waitFor(() => expect(startEvent).toHaveBeenCalledTimes(1));
  });

  it('marks only a locally verified adult shopper for ad initialization', async () => {
    mockDateOfBirth = '1990-06-15';
    const prepareQuizMobileAds = jest
      .fn<
        (
          signal: AbortSignal,
          options?: { ageVerified?: boolean }
        ) => Promise<boolean>
      >()
      .mockResolvedValue(true);
    const { result } = renderHook(() =>
      useQuizStartFlow({
        integrityTier: 'device',
        prepareQuizMobileAds,
        startEvent,
      })
    );

    act(() => result.current.requestStart('event-1'));
    dobOnStart('event-1');

    await waitFor(() => expect(prepareQuizMobileAds).toHaveBeenCalledTimes(1));
    expect(prepareQuizMobileAds).toHaveBeenCalledWith(expect.any(AbortSignal), {
      ageVerified: true,
    });
  });

  it('does not prepare ads until both eligibility gates have passed', async () => {
    const prepareQuizMobileAds = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(true);
    const { result } = renderHook(() =>
      useQuizStartFlow({
        integrityTier: 'device',
        prepareQuizMobileAds,
        startEvent,
      })
    );

    act(() => result.current.requestStart('event-1'));
    await Promise.resolve();
    expect(prepareQuizMobileAds).not.toHaveBeenCalled();

    dobOnStart('event-1');
    await waitFor(() => expect(prepareQuizMobileAds).toHaveBeenCalledTimes(1));
  });

  it('continues the timed start when optional ad prewarm hangs', async () => {
    jest.useFakeTimers();
    try {
      const prepareQuizMobileAds = jest.fn(
        () => new Promise<boolean>(() => {})
      );
      const { result } = renderHook(() =>
        useQuizStartFlow({
          integrityTier: 'device',
          prepareQuizMobileAds,
          startEvent,
        })
      );

      act(() => result.current.requestStart('event-1'));
      dobOnStart('event-1');
      await Promise.resolve();
      act(() => jest.advanceTimersByTime(1500));
      jest.useRealTimers();

      await waitFor(() => {
        expect(startEvent).toHaveBeenCalledTimes(1);
        expect(result.current.adsPrewarmFailed).toBe(true);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the timed start blocked when consent never settles', async () => {
    jest.useFakeTimers();
    try {
      const prepareQuizMobileAds = Object.assign(
        jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        { prepareConsent: () => new Promise<void>(() => {}) }
      );
      const onAdsConsentBlocked = jest.fn();
      const onStartSettled = jest.fn();
      const { result } = renderHook(() =>
        useQuizStartFlow({
          integrityTier: 'device',
          onAdsConsentBlocked,
          onStartSettled,
          prepareQuizMobileAds,
          startEvent,
        })
      );

      act(() => result.current.requestStart('event-1'));
      dobOnStart('event-1');
      await Promise.resolve();
      act(() => jest.advanceTimersByTime(10_000));
      await act(async () => {
        await Promise.resolve();
      });

      expect(onAdsConsentBlocked).toHaveBeenCalledTimes(1);
      expect(onStartSettled).not.toHaveBeenCalled();
      expect(startEvent).not.toHaveBeenCalled();
      expect(prepareQuizMobileAds).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('blocks an ad prewarm retry after failure until a new quiz start', async () => {
    const prepareQuizMobileAds = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(false);
    const { result } = renderHook(() =>
      useQuizStartFlow({
        integrityTier: 'device',
        prepareQuizMobileAds,
        startEvent,
      })
    );

    act(() => result.current.requestStart('event-1'));
    dobOnStart('event-1');
    await waitFor(() => expect(result.current.adsPrewarmFailed).toBe(true));
    expect(prepareQuizMobileAds).toHaveBeenCalledTimes(1);

    act(() => result.current.requestStart('event-2'));
    dobOnStart('event-2');
    await waitFor(() => expect(prepareQuizMobileAds).toHaveBeenCalledTimes(2));
  });

  it('does not start a v2 event when the account switches during ad prewarm', async () => {
    let resolvePreparation!: () => void;
    const prepareQuizMobileAds = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePreparation = () => resolve(true);
        })
    );
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
        await starter('start-request-1').catch(() => undefined);
      }
    );
    const { result } = renderHook(() =>
      useQuizStartFlow({
        events: [
          {
            contractVersion: 2,
            endsAt: '2026-08-03T20:05:00Z',
            id: 'event-v2-prewarm',
            mode: 'test',
            prizeName: 'Phone',
            questionCount: 3,
            rulesVersion: 'quiz-rules-2026-08',
            startsAt: '2026-08-03T20:00:00Z',
            status: 'active',
            title: 'Prewarm switch',
          },
        ],
        integrityTier: 'device',
        prepareQuizMobileAds,
        startEvent,
        startEventV2,
      })
    );

    act(() => result.current.requestStart('event-v2-prewarm', true));
    dobOnStart('event-v2-prewarm');
    await waitFor(() => expect(prepareQuizMobileAds).toHaveBeenCalledTimes(1));
    mockAuthUserId = 'user-b';
    await act(async () => {
      resolvePreparation();
      await Promise.resolve();
    });

    await waitFor(() => expect(startEventV2).toHaveBeenCalledTimes(1));
    expect(startEventV2).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-v2-prewarm',
        userId: null,
      }),
      expect.any(Function)
    );
    expect(mockStartQuizAttemptV2).not.toHaveBeenCalled();
  });
});
