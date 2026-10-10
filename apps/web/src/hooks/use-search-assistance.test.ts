import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { fetchMock, readMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  readMock: vi.fn(),
}));
vi.mock('@baci/shared/lib', async (original) => ({
  ...(await original<typeof import('@baci/shared/lib')>()),
  readAssistanceStream: readMock,
}));

import { useSearchAssistance } from './use-search-assistance';

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  readMock.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('does not request while typing and sends only an explicitly submitted query', async () => {
  const { result } = renderHook(() => useSearchAssistance('iphone', true));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.ask();
  });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/search/assist',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('iphone'),
    })
  );
  expect(result.current.pending).toBe(false);
});
it('preserves keyword search when assistance is unavailable', async () => {
  fetchMock.mockRejectedValue(new Error('network'));
  const { result } = renderHook(() => useSearchAssistance('iphone', true));
  await act(async () => {
    await result.current.ask();
  });
  expect(result.current.query).toBe('iphone');
  expect(result.current.error).toContain('Keep searching');
});
it('shows an assistance error when id generation throws', async () => {
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementationOnce(() => {
    throw new Error('no crypto');
  });
  try {
    const { result } = renderHook(() => useSearchAssistance('iphone', true));
    await act(async () => {
      await result.current.ask();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toContain('Keep searching');
  } finally {
    uuid.mockRestore();
  }
});
it('cancels requests when the shopper changes the query', async () => {
  let finish: () => void = () => {};
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      })
  );
  const { result, rerender } = renderHook(
    ({ query }) => useSearchAssistance(query, true),
    { initialProps: { query: 'iphone' } }
  );
  let request: Promise<void> = Promise.resolve();
  act(() => {
    request = result.current.ask();
  });
  const signal = fetchMock.mock.calls[0][1].signal;
  rerender({ query: 'samsung' });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish();
    await request;
  });
  expect(result.current.query).toBe('samsung');
  expect(result.current.proposal).toBeUndefined();
});
