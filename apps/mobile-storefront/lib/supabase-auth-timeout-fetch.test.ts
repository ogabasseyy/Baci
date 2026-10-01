import { jest } from '@jest/globals';
import { createSupabaseAuthTimeoutFetch } from './supabase-auth-timeout-fetch';

function pendingAbortAwareFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener('abort', abort, { once: true });
      })
  );
}

describe('createSupabaseAuthTimeoutFetch', () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('aborts and settles a pending auth refresh request at the client boundary', async () => {
    jest.useFakeTimers();
    const fetchImpl = pendingAbortAwareFetch();
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);
    const result = timedFetch(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' }
    );

    await jest.advanceTimersByTimeAsync(200);

    await expect(result).resolves.toMatchObject({ status: 408 });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the deadline active until the refresh response body is readable', async () => {
    jest.useFakeTimers();
    let releaseRecovery: (() => void) | undefined;
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Leave the response body open after headers have arrived.
      },
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(stalledBody, { status: 200 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseRecovery = () =>
              resolve(
                Response.json({
                  access_token: 'recovered-token',
                  refresh_token: 'rotated-token',
                })
              );
          })
      );
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    const result = timedFetch(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token'
    );
    await jest.advanceTimersByTimeAsync(100);
    releaseRecovery?.();

    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers immediately when a provider commits before delaying its response', async () => {
    jest.useFakeTimers();
    const committedRequest = pendingAbortAwareFetch();
    const recoveryResponse = Response.json({
      access_token: 'recovered-token',
      refresh_token: 'rotated-token',
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockImplementationOnce(committedRequest)
      .mockResolvedValueOnce(recoveryResponse);
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    const result = timedFetch(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token'
    );
    await jest.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(recoveryResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers when the provider commits before the connection rejects', async () => {
    const recoveryResponse = Response.json({
      access_token: 'recovered-token',
      refresh_token: 'rotated-token',
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection lost after commit'))
      .mockResolvedValueOnce(recoveryResponse);
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    await expect(
      timedFetch(
        'https://project.supabase.co/auth/v1/token?grant_type=refresh_token'
      )
    ).resolves.toBe(recoveryResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers when the provider returns 408 after committing the refresh', async () => {
    const recoveryResponse = Response.json({
      access_token: 'recovered-token',
      refresh_token: 'rotated-token',
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 408 }))
      .mockResolvedValueOnce(recoveryResponse);
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    await expect(
      timedFetch(
        'https://project.supabase.co/auth/v1/token?grant_type=refresh_token'
      )
    ).resolves.toBe(recoveryResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers when a successful refresh response has malformed JSON', async () => {
    const recoveryResponse = Response.json({
      access_token: 'recovered-token',
      refresh_token: 'rotated-token',
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"access_token":', {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      )
      .mockResolvedValueOnce(recoveryResponse);
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    await expect(
      timedFetch(
        'https://project.supabase.co/auth/v1/token?grant_type=refresh_token'
      )
    ).resolves.toBe(recoveryResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers when a successful refresh response omits rotated credentials', async () => {
    const recovered = new Response(
      JSON.stringify({
        access_token: 'recovered-access-token',
        refresh_token: 'recovered-refresh-token',
      }),
      { status: 200 }
    );
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(recovered);

    const result = await createSupabaseAuthTimeoutFetch(fetchImpl)(
      'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' }
    );

    expect(result).toBe(recovered);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clamps both transport attempts to the checkout auth deadline', async () => {
    jest.useFakeTimers();
    const fetchImpl = pendingAbortAwareFetch();
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);
    const result = timedFetch(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      {
        headers: {
          'x-baci-checkout-auth-deadline': String(Date.now() + 70),
        },
        method: 'POST',
      }
    );

    await jest.advanceTimersByTimeAsync(70);

    await expect(result).resolves.toMatchObject({ status: 408 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has(
        'x-baci-checkout-auth-deadline'
      )
    ).toBe(false);
  });

  it('preserves caller cancellation without starting recovery', async () => {
    const caller = new AbortController();
    const fetchImpl = pendingAbortAwareFetch();
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    const result = timedFetch(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', signal: caller.signal }
    );
    caller.abort(new DOMException('Checkout canceled', 'AbortError'));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('clones a POST Request body before retrying refresh recovery', async () => {
    const requestBodies: string[] = [];
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        if (input instanceof Request) requestBodies.push(await input.text());
        return requestBodies.length === 1
          ? new Response(null, { status: 503 })
          : Response.json({
              access_token: 'recovered-token',
              refresh_token: 'rotated-token',
            });
      });
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);
    const request = new Request(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      {
        body: JSON.stringify({ refresh_token: 'opaque-token' }),
        method: 'POST',
      }
    );

    await expect(timedFetch(request)).resolves.toMatchObject({ status: 200 });
    expect(requestBodies).toEqual([
      JSON.stringify({ refresh_token: 'opaque-token' }),
      JSON.stringify({ refresh_token: 'opaque-token' }),
    ]);
  });

  it('returns a successful refresh response before the deadline without aborting it', async () => {
    jest.useFakeTimers();
    const response = Response.json({
      access_token: 'fresh-token',
      refresh_token: 'rotated-token',
    });
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return response;
    });
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl, 100);

    await expect(
      timedFetch(
        'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
        { method: 'POST' }
      )
    ).resolves.toBe(response);
    await jest.advanceTimersByTimeAsync(200);

    expect(requestSignal?.aborted).toBe(false);
  });

  it('does not add a timeout to non-refresh Supabase requests', async () => {
    const response = new Response(null, { status: 204 });
    const fetchImpl = jest.fn<typeof fetch>(async () => response);
    const timedFetch = createSupabaseAuthTimeoutFetch(fetchImpl);

    await expect(
      timedFetch('https://project.supabase.co/rest/v1/products')
    ).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/products',
      undefined
    );
  });
});
