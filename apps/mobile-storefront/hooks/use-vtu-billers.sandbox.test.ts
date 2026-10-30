import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { fetchWithRetry } from '@/lib/api';
import { usePrefetchBillers, useVTUBillers } from './use-vtu-billers';

jest.mock('@/lib/api', () => ({ fetchWithRetry: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const saved = { ...process.env };
let client: QueryClient;
beforeEach(() => {
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  jest
    .mocked(fetchWithRetry)
    .mockResolvedValue({ ok: false, status: 404 } as Response);
});
afterEach(() => {
  client.clear();
  process.env = { ...saved };
  jest.clearAllMocks();
  jest.useRealTimers();
});
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

it('does not schedule unsupported utility prefetch requests in the savings sandbox', async () => {
  jest.useFakeTimers();
  const { unmount } = renderHook(() => usePrefetchBillers(), { wrapper });
  await act(async () => jest.advanceTimersByTimeAsync(5000));
  expect(fetchWithRetry).not.toHaveBeenCalled();
  unmount();
});

it('shows an explicit sandbox-unavailable error without a network request on direct access', async () => {
  const { result, unmount } = renderHook(() => useVTUBillers('data'), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toMatch(
    /not available in this savings sandbox/i
  );
  expect(fetchWithRetry).not.toHaveBeenCalled();
  unmount();
});
