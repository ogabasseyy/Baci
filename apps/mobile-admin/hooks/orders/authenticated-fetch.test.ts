import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
}));

vi.stubGlobal('fetch', mocks.fetch);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

import {
  createAuthenticatedFetch,
  createAuthenticatedFetchText,
} from './authenticated-fetch';

describe('createAuthenticatedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('throws auth session errors before fetching', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
      error: { message: 'Session lookup failed' },
    });

    await expect(
      createAuthenticatedFetch('https://example.test/api', {}, 1000)
    ).rejects.toThrow('Session lookup failed');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('classifies throwing header preparation before fetch as a preflight failure', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    const headers = new Headers();
    vi.spyOn(headers, Symbol.iterator).mockImplementation(() => {
      throw new Error('Invalid local headers');
    });
    await expect(
      createAuthenticatedFetch('https://example.test/api', { headers }, 1000)
    ).rejects.toMatchObject({ name: 'AuthenticatedFetchPreflightError' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('classifies abort-listener setup failures before fetch as preflight failures', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    const caller = new AbortController();
    vi.spyOn(caller.signal, 'addEventListener').mockImplementation(() => {
      throw new Error('Cannot attach local listener');
    });
    await expect(
      createAuthenticatedFetch(
        'https://example.test/api',
        { signal: caller.signal },
        1000
      )
    ).rejects.toMatchObject({ name: 'AuthenticatedFetchPreflightError' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not send a request when its caller already cancelled it', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    const caller = new AbortController();
    caller.abort();
    await expect(
      createAuthenticatedFetch(
        'https://example.test/api',
        { signal: caller.signal },
        1000
      )
    ).rejects.toMatchObject({
      name: 'AuthenticatedFetchPreflightError',
      message: 'Request cancelled before it was sent.',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'success',
    'preflight failure',
  ])('does not let listener cleanup replace a %s or skip timer cleanup', async (outcome) => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    const caller = new AbortController();
    const response = new Response('{}');
    mocks.fetch.mockResolvedValue(response);
    const remove = vi
      .spyOn(caller.signal, 'removeEventListener')
      .mockImplementation(() => {
        throw new Error('Local cleanup failed');
      });
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const add =
      outcome === 'preflight failure'
        ? vi.spyOn(caller.signal, 'addEventListener').mockImplementation(() => {
            throw new Error('Local setup failed');
          })
        : null;
    try {
      const result = createAuthenticatedFetch(
        'https://example.test/api',
        { signal: caller.signal },
        1000
      );
      if (outcome === 'success') await expect(result).resolves.toBe(response);
      else {
        await expect(result).rejects.toMatchObject({
          name: 'AuthenticatedFetchPreflightError',
        });
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
      expect(clear).toHaveBeenCalled();
    } finally {
      remove.mockRestore();
      clear.mockRestore();
      add?.mockRestore();
    }
  });

  it('throws when no session token is available', async () => {
    await expect(
      createAuthenticatedFetch('https://example.test/api', {}, 1000)
    ).rejects.toThrow('Not authenticated');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('adds the bearer token and timeout signal to fetch requests', async () => {
    const response = new Response(JSON.stringify({ ok: true }));
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    mocks.fetch.mockResolvedValue(response);

    await expect(
      createAuthenticatedFetch(
        'https://example.test/api',
        {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
        1000
      )
    ).resolves.toBe(response);

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.test/api',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        }),
        method: 'POST',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('maps AbortError failures to the shared timeout message', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    mocks.fetch.mockRejectedValue(abortError);

    await expect(
      createAuthenticatedFetch('https://example.test/api', {}, 1000)
    ).rejects.toThrow(
      'Request timed out. Please check your connection and try again.'
    );
  });

  it('aborts the internal fetch signal when the caller signal aborts', async () => {
    const callerController = new AbortController();
    const response = new Response(JSON.stringify({ ok: true }));
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
    mocks.fetch.mockImplementation((_url, options: RequestInit) => {
      callerController.abort();
      expect(options.signal?.aborted).toBe(true);
      return Promise.resolve(response);
    });

    await expect(
      createAuthenticatedFetch(
        'https://example.test/api',
        { signal: callerController.signal },
        1000
      )
    ).resolves.toBe(response);
  });
});

describe('createAuthenticatedFetchText body deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
  });

  it('clears the shared deadline when a complete response arrives in time', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const response = {
      text: () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('{}'), 500)),
    } as Response;
    mocks.fetch.mockImplementation((_url, options: RequestInit) => {
      signal = options.signal;
      return Promise.resolve(response);
    });
    try {
      const result = createAuthenticatedFetchText(
        'https://example.test/api',
        {},
        1000
      );
      await vi.advanceTimersByTimeAsync(500);
      await expect(result).resolves.toEqual({ response, text: '{}' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal?.aborted).toBe(false);
      expect(mocks.fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles body rejection after the deadline without an unhandled rejection or retry', async () => {
    vi.useFakeTimers();
    let rejectBody: ((error: Error) => void) | undefined;
    const body = new Promise<string>((_resolve, reject) => {
      rejectBody = reject;
    });
    mocks.fetch.mockResolvedValue({ text: () => body });
    try {
      const result = createAuthenticatedFetchText(
        'https://example.test/api',
        {},
        1000
      ).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({
        message:
          'Request timed out. Please check your connection and try again.',
      });
      rejectBody?.(new Error('Late body cancellation'));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
