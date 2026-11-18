import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  mockFetch,
  mockGetSession,
  quizService,
  resetQuizServiceMocks,
  restoreQuizServiceGlobals,
} from './quiz.test-support';

const { startQuizAttempt, submitQuizAnswer } = quizService;

describe('legacy quiz attempt service', () => {
  afterAll(restoreQuizServiceGlobals);
  beforeEach(resetQuizServiceMocks);

  it('throws when a successful API response violates the quiz contract', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ attemptId: 123 }), { status: 200 })
    );

    await expect(
      startQuizAttempt({
        baseUrl: 'https://example.com',
        eventId: 'event-1',
        integrityTier: 'basic',
      })
    ).rejects.toMatchObject({ code: 'QUIZ_INVALID_RESPONSE', status: 502 });
  });

  it('maps start responses with the spent exam pass and remaining loyalty points', async () => {
    const attempt = {
      attemptId: 'attempt-1',
      eventId: 'event-1',
      examPassPointsSpent: 1,
      question: {
        deadlineAt: '2026-07-08T12:00:30.000Z',
        id: 'question-1',
        index: 1,
        options: [{ id: 'a', label: 'A' }],
        prompt: 'Pick one',
        timeLimitSeconds: 30,
        total: 1,
      },
      remainingLoyaltyPoints: 4,
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(attempt), { status: 200 })
    );

    await expect(
      startQuizAttempt({
        baseUrl: 'https://example.com',
        eventId: 'event-1',
        integrityTier: 'device',
      })
    ).resolves.toEqual(attempt);
  });

  it('refuses to start when the session user differs from the expected shopper', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-123', user: { id: 'user-2' } } },
    });

    await expect(
      startQuizAttempt({
        baseUrl: 'https://example.com',
        eventId: 'event-1',
        expectedUserId: 'user-1',
        integrityTier: 'device',
      })
    ).rejects.toMatchObject({ code: 'quiz_session_changed', status: 409 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('submits answers with the encoded attempt path and bearer auth', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          attemptId: 'attempt/1',
          correctAnswers: 1,
          prizeEligible: true,
          status: 'completed',
          totalQuestions: 1,
        }),
        { status: 200 }
      )
    );

    await expect(
      submitQuizAnswer({
        answer: 'b',
        attemptId: 'attempt/1',
        baseUrl: 'https://example.com',
        integrityTier: 'strong',
        questionId: 'question-1',
      })
    ).resolves.toMatchObject({ attemptId: 'attempt/1', status: 'completed' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/quiz/attempts/attempt%2F1/answers',
      expect.objectContaining({
        body: JSON.stringify({
          answer: 'b',
          integrityTier: 'strong',
          questionId: 'question-1',
        }),
        method: 'POST',
      })
    );
    expect(
      new Headers(mockFetch.mock.calls[0]?.[1]?.headers).get('Authorization')
    ).toBe('Bearer token-123');
  });

  it('maps submit-answer API errors', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Attempt closed', code: 'QUIZ_CLOSED' }),
        { status: 409 }
      )
    );

    await expect(
      submitQuizAnswer({
        answer: 'b',
        attemptId: 'attempt-1',
        baseUrl: 'https://example.com',
        integrityTier: 'basic',
        questionId: 'question-1',
      })
    ).rejects.toMatchObject({
      code: 'QUIZ_CLOSED',
      message: 'Attempt closed',
      status: 409,
    });
  });
});
