import { describe, expect, it, vi } from 'vitest';
import { findJumiaAuthorizationMetadata } from './find-jumia-authorization-metadata';

function buildSupabase(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as never;
}

describe('findJumiaAuthorizationMetadata', () => {
  it('returns safe metadata from the scoped RPC', async () => {
    const supabase = buildSupabase({
      data: [
        {
          id: 'authorization-1',
          token_expires_at: '2026-09-01T12:00:00.000Z',
          refresh_token_expires_at: '2026-10-01T12:00:00.000Z',
          rotation_version: 3,
        },
      ],
      error: null,
    }) as { rpc: ReturnType<typeof vi.fn> };

    await expect(
      findJumiaAuthorizationMetadata({
        clientKeyHash: 'a'.repeat(64),
        merchantId: 'merchant-1',
        supabase: supabase as never,
      })
    ).resolves.toEqual([
      {
        id: 'authorization-1',
        token_expires_at: '2026-09-01T12:00:00.000Z',
        refresh_token_expires_at: '2026-10-01T12:00:00.000Z',
        rotation_version: 3,
      },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'find_jumia_authorization_metadata',
      {
        p_merchant_id: 'merchant-1',
        p_client_key_hash: 'a'.repeat(64),
      }
    );
  });

  it('throws when the metadata RPC fails', async () => {
    await expect(
      findJumiaAuthorizationMetadata({
        clientKeyHash: 'b'.repeat(64),
        merchantId: 'merchant-1',
        supabase: buildSupabase({
          data: null,
          error: new Error('temporary failure'),
        }),
      })
    ).rejects.toThrow('Failed to load existing Jumia authorization');
  });

  it('drops malformed rows without exposing credential fields', async () => {
    await expect(
      findJumiaAuthorizationMetadata({
        clientKeyHash: 'c'.repeat(64),
        merchantId: 'merchant-1',
        supabase: buildSupabase({
          data: [
            {
              id: 'authorization-1',
              credential_ciphertext: 'secret',
            },
          ],
          error: null,
        }),
      })
    ).resolves.toEqual([]);
  });
});
