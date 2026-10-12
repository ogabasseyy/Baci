import { describe, expect, it, jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';

const mockFetch = jest.fn<FetchImplementation>();
global.fetch = mockFetch;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'token' } },
      })),
      getUser: jest.fn(async () => ({
        data: { user: { id: 'user-1' } },
      })),
    },
  },
}));
const { startQuizAttemptV2, submitQuizAnswerV2 } =
  require('./quiz-attempts') as typeof import('./quiz-attempts');

const activeAttempt = {
  attemptId: 'attempt-1',
  eventEndsAt: '2026-08-04T12:05:00.000Z',
  eventId: '22222222-2222-4222-8222-222222222222',
  resultsAvailableAt: null,
  serverNow: '2026-08-04T12:00:00.000Z',
  status: 'in_progress',
  question: {
    deadlineAt: '2026-08-04T12:00:10.000Z',
    id: 'question-1',
    index: 1,
    issuedAt: '2026-08-04T12:00:00.000Z',
    options: [{ id: 'a', label: 'A' }],
    prompt: 'Pick one',
    timeLimitSeconds: 10,
    total: 20,
  },
};

describe('quiz v2 attempt service', () => {
  beforeEach(() => mockFetch.mockReset());

  it('sends contract 2, literal acceptance, app metadata, and a stable request id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(activeAttempt), { status: 200 })
    );
    const startRequestId = '11111111-1111-4111-8111-111111111111';
    await startQuizAttemptV2({
      acceptedRulesVersion: 'test-v1',
      baseUrl: 'https://example.com',
      deviceFingerprint: 'a'.repeat(64),
      eventId: activeAttempt.eventId,
      expectedUserId: 'user-1',
      integrityTier: 'strong',
      mode: 'live',
      startRequestId,
      termsAccepted: true,
    });
    const request = mockFetch.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get('X-Baci-Quiz-Contract')).toBe('2');
    expect(headers.get('X-Baci-Quiz-Device-Fingerprint')).toBe('a'.repeat(64));
    const body = JSON.parse(String(request?.body));
    expect(body).toEqual({
      acceptedRulesVersion: 'test-v1',
      appVersion: expect.any(String),
      entryMode: 'free-v1',
      eventId: activeAttempt.eventId,
      expectedUserId: 'user-1',
      integrityTier: 'strong',
      platform: expect.stringMatching(/android|ios|web/),
      startRequestId,
      termsAccepted: true,
    });
    expect(body).not.toHaveProperty('deviceFingerprint');
  });

  it('rejects a missing live fingerprint asynchronously and omits legacy integrity tier from answers', async () => {
    const rejectedStart = startQuizAttemptV2({
      acceptedRulesVersion: 'live-v1',
      eventId: activeAttempt.eventId,
      expectedUserId: 'user-1',
      integrityTier: 'strong',
      mode: 'live',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      termsAccepted: true,
    });
    await expect(rejectedStart).rejects.toMatchObject({
      code: 'QUIZ_DEVICE_REQUIRED',
      message: expect.stringContaining('device identity'),
      status: 409,
    });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...activeAttempt,
          question: undefined,
          resultsAvailableAt: '2026-08-04T12:06:00.000Z',
          status: 'submitted_pending_results',
        }),
        { status: 200 }
      )
    );
    await submitQuizAnswerV2({
      answer: 'a',
      attemptId: 'attempt-1',
      expectedUserId: 'user-1',
      questionId: 'question-1',
    });
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
      answer: 'a',
      questionId: 'question-1',
    });
  });

  it('preserves v2 API errors and fails closed on malformed v2 responses', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'QUIZ_EVENT_CLOSED', error: 'Quiz closed' }),
          { status: 409 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attemptId: 'missing-contract-fields' }), {
          status: 200,
        })
      );

    await expect(
      submitQuizAnswerV2({
        answer: 'a',
        attemptId: 'attempt-1',
        expectedUserId: 'user-1',
        questionId: 'question-1',
      })
    ).rejects.toMatchObject({
      code: 'QUIZ_EVENT_CLOSED',
      message: 'Quiz closed',
      status: 409,
    });
    await expect(
      startQuizAttemptV2({
        acceptedRulesVersion: 'test-v1',
        deviceFingerprint: 'a'.repeat(64),
        eventId: activeAttempt.eventId,
        expectedUserId: 'user-1',
        integrityTier: 'device',
        mode: 'test',
        startRequestId: '11111111-1111-4111-8111-111111111111',
        termsAccepted: true,
      })
    ).rejects.toMatchObject({ code: 'QUIZ_INVALID_RESPONSE', status: 502 });
  });
});
