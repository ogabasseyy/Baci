// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBuilderBackendClient } from './backend-client';

describe('fixed HTTPS execution client', () => {
  it('forwards only the outer token to the fixed route, with redirects disabled', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ stores: [], nextCursor: null }));
    const execute = createBuilderBackendClient({ fetchImpl });
    expect(await execute('outer.fixture', 'list_storefronts', {})).toEqual({
      stores: [],
      nextCursor: null,
    });
    expect(fetchImpl.mock.calls[0]).toMatchObject([
      'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
      {
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({
          authorization: 'Bearer outer.fixture',
        }),
      },
    ]);
  });
  it('rejects redirects, oversized bodies, HTML and untrusted origins/tools', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.test' },
      })
    );
    const execute = createBuilderBackendClient({ fetchImpl });
    await expect(
      execute('outer.fixture', 'list_storefronts', {})
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    fetchImpl.mockResolvedValue(
      new Response('x'.repeat(150000), {
        headers: { 'content-type': 'application/json' },
      })
    );
    await expect(
      execute('outer.fixture', 'list_storefronts', {})
    ).rejects.toThrow();
    fetchImpl.mockClear();
    await expect(
      execute('outer.fixture', 'https://evil.test' as 'list_storefronts', {})
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('maps authentication failures to the exact reauthorization code without raw errors', async () => {
    const execute = createBuilderBackendClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(Response.json({ token: 'never' }, { status: 403 })),
    });
    expect(
      await execute('outer.fixture', 'list_storefronts', {})
    ).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });
});

it('allows a bounded long build while ordinary tools retain the short budget', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('deadline')), ms);
    return controller.signal;
  });
  try {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 36000);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          },
          { once: true }
        );
      });
      return Response.json({ buildId: 'synthetic' });
    });
    const execute = createBuilderBackendClient({ fetchImpl });
    const build = execute(
      'outer.fixture',
      'finalize_experience_build',
      {}
    ).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    const ordinary = execute('outer.fixture', 'list_storefronts', {});
    const rejected = expect(ordinary).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(36000);
    await rejected;
    expect(await build).toEqual({ value: { buildId: 'synthetic' } });
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it('retains caller cancellation and a finite deadline for build finalization', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const controller = new AbortController();
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal?.aborted).toBe(false);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new Error('cancelled')),
        { once: true }
      );
    });
  });
  try {
    const pending = createBuilderBackendClient({ fetchImpl })(
      'outer.fixture',
      'finalize_experience_build',
      {},
      controller.signal
    );
    const rejected = expect(pending).rejects.toThrow('cancelled');
    expect(timeout).toHaveBeenCalledWith(300000);
    controller.abort();
    await rejected;
  } finally {
    timeout.mockRestore();
  }
});
