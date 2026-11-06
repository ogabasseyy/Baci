import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicSupabaseClient } from './public-supabase-client';
import { getStorefrontSnapshotSupabaseClient } from './storefront-pdp-snapshot-client';

vi.mock('./public-supabase-client', () => ({
  getPublicSupabaseClient: vi.fn(),
}));

describe('getStorefrontSnapshotSupabaseClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the configured anonymous public client', () => {
    const client = { rpc: vi.fn() };
    vi.mocked(getPublicSupabaseClient).mockReturnValue(client as never);

    expect(getStorefrontSnapshotSupabaseClient()).toBe(client);
    expect(getPublicSupabaseClient).toHaveBeenCalledOnce();
  });

  it('propagates public client configuration failures', () => {
    const error = new Error('Supabase public client is not configured');
    vi.mocked(getPublicSupabaseClient).mockImplementation(() => {
      throw error;
    });

    expect(() => getStorefrontSnapshotSupabaseClient()).toThrow(error);
  });
});
