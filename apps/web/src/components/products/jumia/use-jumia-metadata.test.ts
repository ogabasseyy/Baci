import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useJumiaMetadata } from './use-jumia-metadata';

const schema = z.object({ items: z.array(z.string()) });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('scoped Jumia metadata reads', () => {
  it('ignores old success after destination replacement even when fetch ignores abort', async () => {
    let oldResolve: (value: Response) => void = () => undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldResolve = resolve;
          })
      )
      .mockResolvedValueOnce(Response.json({ items: ['new'] }));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ url }) => useJumiaMetadata(url, schema, true),
      { initialProps: { url: '/old' } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ url: '/new' });
    await waitFor(() =>
      expect(result.current.data).toEqual({ items: ['new'] })
    );
    await act(async () => {
      oldResolve(Response.json({ items: ['old'] }));
    });
    expect(result.current.data).toEqual({ items: ['new'] });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('ignores old failure and finally after a new request', async () => {
    let rejectOld: (error: Error) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectOld = reject;
            })
        )
        .mockResolvedValueOnce(Response.json({ items: ['new'] }))
    );
    const { result, rerender } = renderHook(
      ({ url }) => useJumiaMetadata(url, schema, true),
      { initialProps: { url: '/old' } }
    );
    await waitFor(() => expect(result.current.status).toBe('loading'));
    rerender({ url: '/new' });
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => {
      rejectOld(new Error('old failure'));
    });
    expect(result.current.status).toBe('success');
    expect(result.current.error).toBeNull();
  });
  it('fails malformed data then supports retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ invalid: true }))
        .mockResolvedValueOnce(Response.json({ items: [] }))
    );
    const { result } = renderHook(() => useJumiaMetadata('/url', schema, true));
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toEqual({ items: [] }));
  });
  it('shows trusted reconnect guidance for conflicts without echoing server bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'secret-provider-token' }, { status: 409 })
        )
    );
    const { result } = renderHook(() =>
      useJumiaMetadata('/context', schema, true)
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/reconnect jumia.*before retrying/i);
    expect(result.current.error).not.toContain('secret-provider-token');
  });
  it('cancels on unmount and never fetches disabled metadata', async () => {
    const fetcher = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined)
    );
    vi.stubGlobal('fetch', fetcher);
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useJumiaMetadata('/url', schema, enabled),
      { initialProps: { enabled: false } }
    );
    expect(fetcher).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    unmount();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('times out even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined))
    );
    const { result } = renderHook(() => useJumiaMetadata('/url', schema, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/timed out/i);
  });
});
