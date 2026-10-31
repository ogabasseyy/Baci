import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { z } from 'zod';
import {
  legacyQuizEventDefaults,
  mockConfig,
  mockExpoConstants,
  mockFetch,
  quizService,
  resetQuizServiceMocks,
  restoreQuizServiceGlobals,
} from './quiz.test-support';

const { QUIZ_REQUEST_TIMEOUT_MS, fetchQuizEvents, requestQuizV2 } = quizService;

describe('quiz event service', () => {
  // Authentication/transport failures and legacy attempt mutations are kept in
  // quiz-auth.test.ts and quiz-legacy-attempt-service.test.ts, respectively.
  afterAll(restoreQuizServiceGlobals);
  beforeEach(resetQuizServiceMocks);
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('maps event list responses into mobile quiz events with safe legacy defaults', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entryMode: 'free-v1',
          events: [
            {
              endsAt: '2026-05-20T10:10:00.000Z',
              id: 'event-1',
              prizeName: 'N50,000 airtime',
              questionCount: 5,
              startsAt: '2026-05-20T10:00:00.000Z',
              status: 'open',
              title: 'Win airtime',
            },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).resolves.toEqual([
      {
        ...legacyQuizEventDefaults,
        endsAt: '2026-05-20T10:10:00.000Z',
        id: 'event-1',
        liveWindowSeconds: 600,
        maximumPlaySeconds: 150,
        prizeName: 'N50,000 airtime',
        questionCount: 5,
        startsAt: '2026-05-20T10:00:00.000Z',
        serverNowReceivedAtMs: expect.any(Number),
        status: 'open',
        title: 'Win airtime',
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/quiz/events?merchantId=merchant-1&limit=50&offset=0',
      expect.objectContaining({
        method: 'GET',
      })
    );
    expect(
      new Headers(mockFetch.mock.calls[0]?.[1]?.headers).get('Authorization')
    ).toBe('Bearer token-123');
  });

  it('falls back to the configured merchant slug when Expo merchant context is missing', async () => {
    mockExpoConstants.expoConfig = { extra: {} };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entryMode: 'free-v1', events: [] }), {
        status: 200,
      })
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/quiz/events?merchantSlug=ogabassey&limit=50&offset=0',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('fails closed when quiz event pagination does not advance', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entryMode: 'free-v1',
          events: [],
          pagination: {
            hasMore: true,
            limit: 50,
            nextOffset: 0,
            offset: 0,
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'QUIZ_INVALID_RESPONSE',
      message: 'Invalid quiz pagination response',
      status: 502,
    });
  });

  it('fails closed before event requests when merchant context is unavailable', async () => {
    mockExpoConstants.expoConfig = { extra: {} };
    mockConfig.MERCHANT_SLUG = '';

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'QUIZ_CONFIGURATION_REQUIRED',
      status: 500,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws mapped quiz errors from API error responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Quiz closed', code: 'QUIZ_CLOSED' }),
        { status: 409 }
      )
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toMatchObject({
      code: 'QUIZ_CLOSED',
      message: 'Quiz closed',
      status: 409,
    });
  });

  it('applies verified auth headers last regardless of caller header casing', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await requestQuizV2(
      '/api/quiz/test',
      {
        headers: {
          authorization: 'Bearer caller-controlled-token',
        },
        method: 'GET',
      },
      z.object({ ok: z.literal(true) }),
      { baseUrl: 'https://example.com' }
    );

    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
    expect(headers.get('Authorization')).not.toContain(
      'caller-controlled-token'
    );
  });

  it('times out a stalled quiz request and releases its timer', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true }
          );
        })
    );

    const request = requestQuizV2(
      '/api/quiz/test',
      { method: 'GET' },
      z.object({ ok: z.literal(true) }),
      { baseUrl: 'https://example.com' }
    );
    const rejection = expect(request).rejects.toMatchObject({
      code: 'QUIZ_REQUEST_TIMEOUT',
      status: 504,
    });
    await jest.advanceTimersByTimeAsync(QUIZ_REQUEST_TIMEOUT_MS);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('composes a caller abort signal with the quiz timeout signal', async () => {
    const controller = new AbortController();
    const abortError = new Error('caller cancelled');
    abortError.name = 'AbortError';
    mockFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError), {
            once: true,
          });
        })
    );

    const request = requestQuizV2(
      '/api/quiz/test',
      { method: 'GET', signal: controller.signal },
      z.object({ ok: z.literal(true) }),
      { baseUrl: 'https://example.com' }
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(mockFetch).toHaveBeenCalled();
    controller.abort();

    await expect(request).rejects.toBe(abortError);
  });
});
