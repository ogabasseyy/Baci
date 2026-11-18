// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { oxygenProcessingOrder } from '@/test/fixtures/oxygen-follow-up';
import { useOxygenFollowUps } from './useOxygenFollowUps';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  useMerchant: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('./fetchOxygenFollowUps', () => ({
  fetchOxygenFollowUps: mocks.fetch,
}));
vi.mock('./useMerchant', () => ({ useMerchant: mocks.useMerchant }));

describe('useOxygenFollowUps', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useQuery.mockReturnValue({});
  });

  it('disables the query until a merchant is available', () => {
    mocks.useMerchant.mockReturnValue({ merchant: null });

    const { result } = renderHook(useOxygenFollowUps);

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ['oxygen-follow-ups', undefined],
      })
    );
    const options = mocks.useQuery.mock.calls[0][0];
    expect(() => options.queryFn()).toThrow('Merchant ID is required');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result.current.isIncomplete).toBe(false);
  });

  it('keys the request to the merchant and preserves the incomplete flag', async () => {
    const payload = { orders: [oxygenProcessingOrder], isIncomplete: true };
    mocks.useMerchant.mockReturnValue({ merchant: { id: 'merchant-a' } });
    mocks.fetch.mockResolvedValue(payload);
    mocks.useQuery.mockReturnValue({ data: payload, isPending: false });

    const { result } = renderHook(useOxygenFollowUps);

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: ['oxygen-follow-ups', 'merchant-a'],
        staleTime: 120_000,
        refetchOnWindowFocus: false,
      })
    );
    await expect(mocks.useQuery.mock.calls[0][0].queryFn()).resolves.toBe(
      payload
    );
    expect(mocks.fetch).toHaveBeenCalledWith('merchant-a');
    expect(result.current).toMatchObject({
      data: payload.orders,
      isIncomplete: true,
    });
  });

  it('preserves query errors when the provider lookup fails', async () => {
    const error = new Error('Lookup unavailable');
    mocks.useMerchant.mockReturnValue({ merchant: { id: 'merchant-a' } });
    mocks.fetch.mockRejectedValue(error);
    mocks.useQuery.mockReturnValue({ error, isError: true });

    const { result } = renderHook(useOxygenFollowUps);

    await expect(mocks.useQuery.mock.calls[0][0].queryFn()).rejects.toBe(error);
    expect(result.current).toMatchObject({
      error,
      isError: true,
      isIncomplete: false,
    });
  });
});
