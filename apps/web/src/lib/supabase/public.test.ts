import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { createPublicClient } from '@/lib/supabase/public';

describe('createPublicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    mockCreateClient.mockReturnValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('applies the shared operation deadline to every hydration request and blocks later fetches', async () => {
    const deadline = new AbortController();
    const request = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));
    createPublicClient({ clientInfo: 'bounded-hub', signal: deadline.signal });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: { fetch: (url: string, init?: RequestInit) => Promise<Response> };
    };
    await options.global.fetch('https://example.com/products', {
      signal: request.signal,
    });
    await options.global.fetch('https://example.com/variants');
    const signals = fetchSpy.mock.calls.map((call) => call[1]?.signal);
    expect(signals.every((signal) => signal && !signal.aborted)).toBe(true);
    deadline.abort();
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    expect(() => options.global.fetch('https://example.com/counts')).toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses only the timeout signal when no caller signal is provided', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    createPublicClient({
      clientInfo: 'baci-web-live-blog-post',
      timeoutMs: 50,
    });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: {
        fetch: (url: string, requestOptions?: RequestInit) => Promise<Response>;
      };
    };

    await options.global.fetch('https://example.com/data', {
      headers: { 'X-Test': '1' },
    });

    expect(timeoutSpy).toHaveBeenCalledWith(50);
    expect(anySpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/data', {
      headers: { 'X-Test': '1' },
      signal: timeoutSignal,
    });
  });

  it('composes caller and timeout signals when both are present', async () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const combinedSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, 'any').mockReturnValue(combinedSignal);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    createPublicClient({
      clientInfo: 'baci-web-live-blog-post',
      timeoutMs: 75,
    });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: {
        fetch: (url: string, requestOptions?: RequestInit) => Promise<Response>;
      };
    };

    await options.global.fetch('https://example.com/data', {
      headers: { 'X-Test': '2' },
      signal: callerSignal,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(75);
    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/data', {
      headers: { 'X-Test': '2' },
      signal: combinedSignal,
    });
  });

  it('propagates fetch failures while preserving timeout-only behavior', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network failed'));

    createPublicClient({
      clientInfo: 'baci-web-live-blog-post',
      timeoutMs: 25,
    });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: {
        fetch: (url: string, requestOptions?: RequestInit) => Promise<Response>;
      };
    };

    await expect(
      options.global.fetch('https://example.com/data', {
        headers: { 'X-Test': '3' },
      })
    ).rejects.toThrow('network failed');
    expect(timeoutSpy).toHaveBeenCalledWith(25);
    expect(anySpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/data', {
      headers: { 'X-Test': '3' },
      signal: timeoutSignal,
    });
  });

  it('propagates abort failures while preserving composed signals', async () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const combinedSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, 'any').mockReturnValue(combinedSignal);
    const abortError = new DOMException('Request aborted', 'AbortError');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(abortError);

    createPublicClient({
      clientInfo: 'baci-web-live-blog-post',
      timeoutMs: 40,
    });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: {
        fetch: (url: string, requestOptions?: RequestInit) => Promise<Response>;
      };
    };

    await expect(
      options.global.fetch('https://example.com/data', {
        headers: { 'X-Test': '4' },
        signal: callerSignal,
      })
    ).rejects.toThrow('Request aborted');
    expect(timeoutSpy).toHaveBeenCalledWith(40);
    expect(anySpy).toHaveBeenCalledWith([callerSignal, timeoutSignal]);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/data', {
      headers: { 'X-Test': '4' },
      signal: combinedSignal,
    });
  });

  it('uses the shared bounded build transport for PDP index clients', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'bounded');
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    createPublicClient({ clientInfo: 'baci-storefront-product-index' });
    const options = mockCreateClient.mock.calls[0][2] as {
      global: {
        fetch: (url: string, requestOptions?: RequestInit) => Promise<Response>;
      };
    };

    await options.global.fetch('https://example.com/product-index');

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/product-index',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
