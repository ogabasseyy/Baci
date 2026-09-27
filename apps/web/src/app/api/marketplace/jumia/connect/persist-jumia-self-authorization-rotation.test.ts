import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findJumiaAuthorizationMetadata } from '@/lib/jumia/find-jumia-authorization-metadata';
import { persistJumiaSelfAuthorizationRotation } from './persist-jumia-self-authorization-rotation';

vi.mock('@/lib/jumia/find-jumia-authorization-metadata', () => ({
  findJumiaAuthorizationMetadata: vi.fn(),
}));

function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
  };
  Object.defineProperty(builder, 'then', {
    value: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data, error })),
  });
  return builder;
}

function buildSupabase(args: {
  authorizations?: unknown[];
  authorizationError?: unknown;
  integrations?: unknown[];
  integrationError?: unknown;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn((table: string) =>
    table === 'jumia_authorizations'
      ? query(args.authorizations ?? [], args.authorizationError)
      : query(args.integrations ?? [], args.integrationError)
  );
  return { from, rpc } as never;
}

const baseArgs = {
  merchantId: 'merchant-1',
  clientKeyHash: 'hash-1',
  credentialCiphertext: 'ciphertext',
  accessTokenExpiresAt: '2026-08-31T12:00:00.000Z',
  refreshTokenExpiresAt: '2026-09-30T12:00:00.000Z',
};

describe('persistJumiaSelfAuthorizationRotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([]);
  });

  it('persists rotated credentials for integrations sharing one authorization grant', async () => {
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([
      {
        id: 'authorization-1',
        token_expires_at: '2026-08-31T12:00:00.000Z',
        refresh_token_expires_at: '2026-09-30T12:00:00.000Z',
        rotation_version: 4,
      },
    ]);
    const supabase = buildSupabase({
      authorizations: [{ id: 'authorization-1', rotation_version: 4 }],
      integrations: [
        {
          shop_id: 'shop-1',
          country_code: 'NG',
          marketplace_key: 'NG-RETAIL',
          connection_method: 'self_authorization',
          jumia_authorization_id: 'authorization-1',
        },
      ],
    }) as { rpc: ReturnType<typeof vi.fn> };

    await expect(
      persistJumiaSelfAuthorizationRotation({
        ...baseArgs,
        supabase: supabase as never,
      })
    ).resolves.toBe(4);

    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_jumia_self_authorization_ordered',
      expect.objectContaining({
        p_client_key_hash: 'hash-1',
        p_shop_ids: ['shop-1'],
        p_business_client_codes: ['NG-RETAIL'],
        p_expected_rotation_version: 4,
      })
    );
  });

  it('skips persistence when no matching authorization grant exists', async () => {
    const supabase = buildSupabase({
      authorizations: [],
      integrations: [],
    }) as { rpc: ReturnType<typeof vi.fn> };

    await persistJumiaSelfAuthorizationRotation({
      ...baseArgs,
      supabase: supabase as never,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('skips persistence when the authorization lookup is ambiguous', async () => {
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([
      {
        id: 'authorization-1',
        token_expires_at: '2026-08-31T12:00:00.000Z',
        refresh_token_expires_at: '2026-09-30T12:00:00.000Z',
        rotation_version: 1,
      },
      {
        id: 'authorization-2',
        token_expires_at: '2026-08-31T12:00:00.000Z',
        refresh_token_expires_at: '2026-09-30T12:00:00.000Z',
        rotation_version: 1,
      },
    ]);
    const supabase = buildSupabase({
      authorizations: [
        { id: 'authorization-1', rotation_version: 1 },
        { id: 'authorization-2', rotation_version: 1 },
      ],
    }) as { rpc: ReturnType<typeof vi.fn> };

    await persistJumiaSelfAuthorizationRotation({
      ...baseArgs,
      supabase: supabase as never,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('throws when the existing integration scope cannot be loaded', async () => {
    vi.mocked(findJumiaAuthorizationMetadata).mockResolvedValue([
      {
        id: 'authorization-1',
        token_expires_at: '2026-08-31T12:00:00.000Z',
        refresh_token_expires_at: '2026-09-30T12:00:00.000Z',
        rotation_version: 1,
      },
    ]);
    const supabase = buildSupabase({
      authorizations: [{ id: 'authorization-1', rotation_version: 1 }],
      integrationError: new Error('temporary failure'),
    });

    await expect(
      persistJumiaSelfAuthorizationRotation({
        ...baseArgs,
        supabase: supabase as never,
      })
    ).rejects.toThrow('Failed to load existing Jumia authorization scope');
  });
});
