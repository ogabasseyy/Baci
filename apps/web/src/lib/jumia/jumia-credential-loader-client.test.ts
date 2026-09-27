import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createScopedClient: vi.fn(),
  signScopedSupabaseJwt: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.signScopedSupabaseJwt,
}));

import { createJumiaCredentialLoaderClient } from './jumia-credential-loader-client';

describe('createJumiaCredentialLoaderClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signScopedSupabaseJwt.mockReturnValue('signed-loader-token');
    mocks.createScopedClient.mockReturnValue({ rpc: vi.fn() });
  });

  it('binds a short-lived server capability to one user and merchant', () => {
    const client = createJumiaCredentialLoaderClient(
      'user-1',
      '123e4567-e89b-12d3-a456-426614174000',
      new Date('2026-09-03T10:00:00.000Z')
    );

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        aud: 'authenticated',
        exp: 1_788_429_660,
        iat: 1_788_429_600,
        jumia_credential_context: 'server-grant-load',
        jumia_credential_merchant_id: '123e4567-e89b-12d3-a456-426614174000',
        jumia_credential_user_id: 'user-1',
        role: 'jumia_credential_loader',
      })
    );
    expect(mocks.createScopedClient).toHaveBeenCalledWith(
      'signed-loader-token'
    );
    expect(client).toBe(mocks.createScopedClient.mock.results[0]?.value);
  });
});
