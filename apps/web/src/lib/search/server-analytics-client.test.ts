import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockInsert, mockCreateServiceClient } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockInsert = vi.fn();
  const mockCreateServiceClient = vi.fn(() => ({ from: mockFrom }));
  mockFrom.mockReturnValue({ insert: mockInsert });
  return { mockFrom, mockInsert, mockCreateServiceClient };
});

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mockCreateServiceClient,
}));

import { recordSearchSubmission } from './server-analytics-client';

describe('recordSearchSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('inserts through the search-analytics brand', async () => {
    const row = {
      merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      search_query: 'phone',
      results_count: 27,
      search_method: 'client' as const,
    };

    const result = await recordSearchSubmission(row);

    expect(mockCreateServiceClient).toHaveBeenCalledWith('search-analytics');
    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('search_analytics');
    expect(mockInsert).toHaveBeenCalledExactlyOnceWith(row);
    expect(result).toEqual({ error: null });
  });

  it.each([
    ['non-uuid merchant', { merchant_id: 'not-a-uuid' }],
    ['empty query', { search_query: '' }],
    ['oversized query', { search_query: 'q'.repeat(201) }],
    ['negative count', { results_count: -1 }],
    ['fractional count', { results_count: 1.5 }],
    ['wrong method', { search_method: 'server' }],
  ])('rejects %s before touching the service client', async (_label, override) => {
    await expect(
      recordSearchSubmission({
        merchant_id: '123e4567-e89b-12d3-a456-426614174000',
        search_query: 'phone',
        results_count: 27,
        search_method: 'client',
        ...override,
      } as never)
    ).rejects.toThrow('Invalid search submission row');
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'nope'],
  ])('rejects %s rows without dereferencing them', async (_label, row) => {
    await expect(recordSearchSubmission(row as never)).rejects.toThrow(
      'Invalid search submission row'
    );
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('propagates insert errors', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'db down' } });

    const result = await recordSearchSubmission({
      merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      search_query: 'phone',
      results_count: 0,
      search_method: 'client',
    });

    expect(result).toEqual({ error: { message: 'db down' } });
  });
});
