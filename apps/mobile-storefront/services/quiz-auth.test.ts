import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  mockFetch,
  mockGetSession,
  mockGetUser,
  mockLogWarn,
  quizService,
  resetQuizServiceMocks,
  restoreQuizServiceGlobals,
} from './quiz.test-support';

const { fetchQuizEvents } = quizService;

describe('quiz service authentication and transport errors', () => {
  afterAll(restoreQuizServiceGlobals);
  beforeEach(resetQuizServiceMocks);
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fails closed when the mobile bearer session is persistently missing', async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const resultPromise = fetchQuizEvents({ baseUrl: 'https://example.com' });
    const expectation = expect(resultPromise).rejects.toMatchObject({
      code: 'QUIZ_AUTH_REQUIRED',
      message: 'Quiz authentication required',
      status: 401,
    });
    await jest.advanceTimersByTimeAsync(300);
    await expectation;

    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retries transient mobile bearer session read errors once', async () => {
    jest.useFakeTimers();
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'network timeout' },
      })
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'token-123', user: { id: 'user-1' } },
        },
        error: null,
      });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entryMode: 'free-v1', events: [] }), {
        status: 200,
      })
    );

    const resultPromise = fetchQuizEvents({ baseUrl: 'https://example.com' });
    await jest.advanceTimersByTimeAsync(300);

    await expect(resultPromise).resolves.toEqual([]);
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Unable to read quiz auth session',
      expect.objectContaining({ attempt: 1, message: 'network timeout' })
    );
  });

  it('fails closed on a definitive bearer-session auth error', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'invalid refresh token', status: 401 },
    });

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toMatchObject({ code: 'QUIZ_AUTH_REQUIRED', status: 401 });
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not ask Supabase Auth to validate the token: the server does', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entryMode: 'free-v1', events: [] }), {
        status: 200,
      })
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).resolves.toEqual([]);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('fails closed when the stored session has a token but never a user', async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-123' } },
    });

    const resultPromise = fetchQuizEvents({ baseUrl: 'https://example.com' });
    const expectation = expect(resultPromise).rejects.toMatchObject({
      code: 'QUIZ_AUTH_REQUIRED',
      status: 401,
    });
    await jest.advanceTimersByTimeAsync(300);
    await expectation;

    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retries once when the stored session has a token but no user yet', async () => {
    jest.useFakeTimers();
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: { access_token: 'token-123' } },
      })
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'token-123', user: { id: 'user-1' } },
        },
      });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entryMode: 'free-v1', events: [] }), {
        status: 200,
      })
    );

    const resultPromise = fetchQuizEvents({ baseUrl: 'https://example.com' });
    await jest.advanceTimersByTimeAsync(300);

    await expect(resultPromise).resolves.toEqual([]);
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('propagates network-level fetch failures', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toThrow('network down');
  });

  it('logs only safe metadata when API JSON parsing fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(
      new Response('session-token=secret', { status: 200 })
    );

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).rejects.toMatchObject({ code: 'QUIZ_INVALID_RESPONSE', status: 502 });

    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to parse quiz API JSON response',
      expect.objectContaining({ errorName: expect.any(String), status: 200 })
    );
    const loggedMetadata = warnSpy.mock.calls[0]?.[1];
    const metadataKeys =
      loggedMetadata && typeof loggedMetadata === 'object'
        ? Object.keys(loggedMetadata)
        : [];
    expect(
      metadataKeys.some((key) => /(body|text|response|data|content)/i.test(key))
    ).toBe(false);
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain(
      'session-token=secret'
    );
  });
});
