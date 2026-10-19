import { act, renderHook } from '@testing-library/react-native';

const mockFetch = jest.fn();
const mockRead = jest.fn();
const mockRandomUUID = jest.fn(() => '019c6e27-e55b-73d1-87d8-4e01f1f75043');
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));
jest.mock('@baci/shared/lib', () => ({
  ...jest.requireActual('@baci/shared/lib'),
  readAssistanceStream: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_SLUG: 'test-store' },
}));

import { useSearchAssistance } from './use-search-assistance';

describe('optional search assistance', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SEARCH_ASSIST_URL =
      'http://localhost:3001/api/search/assist';
    mockFetch.mockReset().mockResolvedValue({ ok: true });
    mockRead.mockReset().mockResolvedValue(undefined);
  });
  it('does not run while typing and cancels an older request on a query change', async () => {
    let finish: (() => void) | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        })
    );
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useSearchAssistance(query),
      { initialProps: { query: 'iphone' } }
    );
    expect(mockFetch).not.toHaveBeenCalled();
    let pending: Promise<void>;
    act(() => {
      pending = result.current.ask();
    });
    const signal = mockFetch.mock.calls[0][1].signal;
    rerender({ query: 'samsung' });
    expect(signal.aborted).toBe(true);
    expect(result.current.pending).toBe(false);
    await act(async () => {
      finish?.();
      await pending;
    });
    expect(result.current.proposal).toBeUndefined();
  });
  it('rejects failed assistance without changing the query', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSearchAssistance('iphone'));
    await act(async () => {
      await result.current.ask();
    });
    expect(result.current.error).toContain('Keep searching');
    expect(result.current.query).toBe('iphone');
  });
  it('shows an assistance error when id generation throws', async () => {
    mockRandomUUID.mockImplementationOnce(() => {
      throw new Error('no crypto');
    });
    const { result } = renderHook(() => useSearchAssistance('iphone'));
    await act(async () => {
      await result.current.ask();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toContain('Keep searching');
  });
});
it('does not reopen a dismissed proposal when an unfinished stream rejects', async () => {
  process.env.EXPO_PUBLIC_SEARCH_ASSIST_URL =
    'http://localhost:3001/api/search/assist';
  mockFetch.mockReset().mockResolvedValue({ ok: true });
  mockRead.mockReset();
  let reject: (error: Error) => void = () => {};
  mockRead.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  const { result } = renderHook(() => useSearchAssistance('iphone'));
  let pending: Promise<void>;
  await act(async () => {
    pending = result.current.ask();
    await Promise.resolve();
  });
  expect(mockRead).toHaveBeenCalled();
  act(() => result.current.dismiss());
  await act(async () => {
    reject(new Error('cancelled'));
    await pending;
  });
  expect(result.current.error).toBeUndefined();
  expect(result.current.pending).toBe(false);
});

it('asserts the build merchant so unsupported builds fail closed', async () => {
  process.env.EXPO_PUBLIC_SEARCH_ASSIST_URL =
    'http://localhost:3001/api/search/assist';
  mockFetch.mockReset().mockResolvedValue({ ok: true });
  mockRead.mockReset().mockResolvedValue(undefined);
  const { result } = renderHook(() => useSearchAssistance('iphone'));
  await act(async () => {
    await result.current.ask();
  });
  expect(mockFetch).toHaveBeenCalledWith(
    'http://localhost:3001/api/search/assist',
    expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        'x-baci-storefront-slug': 'test-store',
      },
    })
  );
});
