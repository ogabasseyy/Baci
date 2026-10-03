import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: { select: vi.fn(), eq: vi.fn(), in: vi.fn(), abortSignal: vi.fn() },
  client: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.client }));
vi.mock('@/lib/normalize-product', () => ({
  normalizeProduct: (row: unknown) => row,
}));

import { useSearchComparisonFacts } from './use-search-comparison-facts';

beforeEach(() => {
  Object.values(mocks.query).forEach((fn) => {
    fn.mockReset().mockReturnValue(mocks.query);
  });
  mocks.client.mockReturnValue({ from: () => mocks.query });
});
it('refreshes only selected identities scoped to the active merchant and public status', async () => {
  mocks.query.abortSignal.mockResolvedValue({
    data: [{ id: 'p2', name: 'Other page', price: 250 }],
    error: null,
  });
  const { result } = renderHook(() =>
    useSearchComparisonFacts('m1', ['p1', 'p2'], true)
  );
  await waitFor(() => expect(result.current.products).toHaveLength(1));
  expect(mocks.query.eq).toHaveBeenCalledWith('merchant_id', 'm1');
  expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
  expect(mocks.query.in).toHaveBeenCalledWith('id', ['p1', 'p2']);
});
it('dedupes and drops empty ids before the facts query', async () => {
  mocks.query.abortSignal.mockResolvedValue({ data: [], error: null });
  renderHook(() => useSearchComparisonFacts('m1', ['p1', '', 'p1'], true));
  await waitFor(() =>
    expect(mocks.query.in).toHaveBeenCalledWith('id', ['p1'])
  );
});
it('retains selection externally and suppresses unverified facts on a refresh failure', async () => {
  mocks.query.abortSignal.mockResolvedValue({
    data: null,
    error: { message: 'network' },
  });
  const { result } = renderHook(() =>
    useSearchComparisonFacts('m1', ['p1'], true)
  );
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.products).toEqual([]);
});
