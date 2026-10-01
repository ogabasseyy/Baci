import { describe, expect, it, vi } from 'vitest';

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(() => ({ rpc: vi.fn() })),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient }));

import { createAdsSpendServiceClient } from './server-spend-client';

describe('createAdsSpendServiceClient', () => {
  it('uses the branded server-only service client', () => {
    expect(createAdsSpendServiceClient()).toEqual({
      rpc: expect.any(Function),
    });
    expect(createServiceClient).toHaveBeenCalledWith('event-pipeline');
  });
});
