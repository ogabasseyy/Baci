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
    data: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Other page',
        price: 250,
      },
    ],
    error: null,
  });
  const { result } = renderHook(() =>
    useSearchComparisonFacts(
      'm1',
      [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      true
    )
  );
  await waitFor(() => expect(result.current.products).toHaveLength(1));
  expect(mocks.query.eq).toHaveBeenCalledWith('merchant_id', 'm1');
  expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
  expect(mocks.query.in).toHaveBeenCalledWith('id', [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  ]);
});
it('dedupes and drops empty ids before the facts query', async () => {
  mocks.query.abortSignal.mockResolvedValue({ data: [], error: null });
  renderHook(() =>
    useSearchComparisonFacts(
      'm1',
      [
        '11111111-1111-1111-1111-111111111111',
        '',
        '11111111-1111-1111-1111-111111111111',
      ],
      true
    )
  );
  await waitFor(() =>
    expect(mocks.query.in).toHaveBeenCalledWith('id', [
      '11111111-1111-1111-1111-111111111111',
    ])
  );
});
it('drops malformed ids so one poisoned entry cannot fail the refresh', async () => {
  mocks.query.abortSignal.mockResolvedValue({ data: [], error: null });
  const { result } = renderHook(() =>
    useSearchComparisonFacts(
      'm1',
      ['not-a-uuid', '22222222-2222-2222-2222-222222222222'],
      true
    )
  );
  await waitFor(() =>
    expect(mocks.query.in).toHaveBeenCalledWith('id', [
      '22222222-2222-2222-2222-222222222222',
    ])
  );
  expect(result.current.error).toBe(false);
});
it('skips the round-trip when no valid id remains', async () => {
  const { result } = renderHook(() =>
    useSearchComparisonFacts('m1', ['not-a-uuid'], true)
  );
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(mocks.query.in).not.toHaveBeenCalled();
  expect(result.current.products).toEqual([]);
  expect(result.current.error).toBe(false);
});
it('retains selection externally and suppresses unverified facts on a refresh failure', async () => {
  mocks.query.abortSignal.mockResolvedValue({
    data: null,
    error: { message: 'network' },
  });
  const { result } = renderHook(() =>
    useSearchComparisonFacts(
      'm1',
      ['11111111-1111-1111-1111-111111111111'],
      true
    )
  );
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.products).toEqual([]);
});
