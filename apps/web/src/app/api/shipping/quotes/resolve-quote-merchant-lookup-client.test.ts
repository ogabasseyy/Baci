import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveQuoteMerchantLookupClient } from './resolve-quote-merchant-lookup-client';

const mockCreateServerClient = vi.hoisted(() => vi.fn());
const mockCreateScopedClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateServerClient,
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mockCreateScopedClient,
}));

describe('resolveQuoteMerchantLookupClient', () => {
  const serverClient = { kind: 'server' as const };
  const scopedClient = { kind: 'scoped' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServerClient.mockResolvedValue(serverClient);
    mockCreateScopedClient.mockReturnValue(scopedClient);
  });

  it('falls back to the cookie client when the Bearer token is rejected', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'JWT expired' },
        }),
      },
    };

    const client = await resolveQuoteMerchantLookupClient(
      {
        headers: {
          get: (name) =>
            name.toLowerCase() === 'authorization'
              ? 'Bearer stale-token'
              : null,
        },
      },
      supabase as never
    );

    expect(supabase.auth.getUser).toHaveBeenCalledWith('stale-token');
    expect(mockCreateServerClient).toHaveBeenCalled();
    expect(mockCreateScopedClient).not.toHaveBeenCalled();
    expect(client).toBe(serverClient);
  });

  it('returns a scoped client when the Bearer token validates', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    };

    const client = await resolveQuoteMerchantLookupClient(
      {
        headers: {
          get: (name) =>
            name.toLowerCase() === 'authorization'
              ? 'Bearer valid-token'
              : null,
        },
      },
      supabase as never
    );

    expect(supabase.auth.getUser).toHaveBeenCalledWith('valid-token');
    expect(mockCreateScopedClient).toHaveBeenCalledWith('valid-token');
    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(client).toBe(scopedClient);
  });

  it('returns the server client without auth when authorization is absent', async () => {
    const supabase = {
      auth: {
        getUser: vi.fn(),
      },
    };

    const client = await resolveQuoteMerchantLookupClient(
      {
        headers: {
          get: () => null,
        },
      },
      supabase as never
    );

    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(mockCreateScopedClient).not.toHaveBeenCalled();
    expect(mockCreateServerClient).toHaveBeenCalled();
    expect(client).toBe(serverClient);
  });
});
