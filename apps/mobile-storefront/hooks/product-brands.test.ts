import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRpc = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFrom = jest.fn();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { fetchAvailableBrands } from './product-brands';

describe('fetchAvailableBrands normalized-empty search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no brands instead of all brands for punctuation-only queries', async () => {
    const result = await fetchAvailableBrands('merchant-1', { search: '!!' });

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
