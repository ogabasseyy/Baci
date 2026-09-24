import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc, mockCredentialRpc, mockGetUser, mockMerchantForApiRequest } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockCredentialRpc: vi.fn(),
    mockGetUser: vi.fn(),
    mockMerchantForApiRequest: vi.fn(),
  }));

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/get-merchant-for-api-request')>();
  return {
    ...original,
    getMerchantForApiRequest: mockMerchantForApiRequest,
  };
});

vi.mock('@/lib/jumia/server-credential-client', () => ({
  createJumiaCredentialServiceClient: vi.fn(() => ({
    rpc: mockCredentialRpc,
  })),
}));

import { loadJumiaAuthorizationGrant } from '@/lib/jumia/load-jumia-authorization-grant';
import { createJumiaCredentialServiceClient } from '@/lib/jumia/server-credential-client';

const supabase = {
  rpc: mockRpc,
  auth: { getUser: mockGetUser },
};

const grantRow = {
  credential_ciphertext: 'opaque-ciphertext',
  token_expires_at: '2026-03-27T10:00:00.000Z',
  refresh_token_expires_at: '2026-04-27T10:00:00.000Z',
  rotation_version: 2,
  client_key_hash: 'a'.repeat(64),
};

function ownerContext(merchantId: string) {
  return {
    merchantId,
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: {},
    },
  };
}

describe('loadJumiaAuthorizationGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Privileged worker path by default: sessionless client, no user check.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('returns the scoped authorization grant from the caller RPC', async () => {
    mockRpc.mockResolvedValue({ data: [grantRow], error: null });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).resolves.toEqual(grantRow);
    expect(mockRpc).toHaveBeenCalledWith(
      'load_jumia_authorization_credentials',
      {
        p_authorization_id: 'auth-1',
        p_merchant_id: 'merchant-1',
      }
    );
    expect(createJumiaCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('returns a retryable service error when the worker RPC fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Not authorized' },
    });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).rejects.toMatchObject({ status: 503 });
  });

  it('preserves permission failures from the worker RPC', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Not authorized' },
    });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a grant row without refresh-token expiry metadata', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          credential_ciphertext: 'opaque-ciphertext',
          token_expires_at: '2026-03-27T10:00:00.000Z',
          rotation_version: 2,
          client_key_hash: 'a'.repeat(64),
        },
      ],
      error: null,
    });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('authorizes the user then executes with the server credential client', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockMerchantForApiRequest.mockResolvedValue(ownerContext('merchant-1'));
    mockCredentialRpc.mockResolvedValue({ data: [grantRow], error: null });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).resolves.toEqual(grantRow);

    expect(mockMerchantForApiRequest).toHaveBeenCalledWith(supabase, 'user-1', {
      requestedMerchantId: 'merchant-1',
    });
    expect(createJumiaCredentialServiceClient).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCredentialRpc).toHaveBeenCalledWith(
      'load_jumia_authorization_credentials',
      {
        p_authorization_id: 'auth-1',
        p_merchant_id: 'merchant-1',
      }
    );
  });

  it('denies users without manage access before touching the RPC', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      staffAccess: {
        isStaff: true,
        isOwner: false,
        role: 'viewer',
        permissions: { integrations: { view: true } },
      },
    });

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).rejects.toMatchObject({ status: 403 });

    expect(createJumiaCredentialServiceClient).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCredentialRpc).not.toHaveBeenCalled();
  });

  it('denies users resolved to a different merchant', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockMerchantForApiRequest.mockResolvedValue(ownerContext('merchant-other'));

    await expect(
      loadJumiaAuthorizationGrant(supabase as never, 'auth-1', 'merchant-1')
    ).rejects.toMatchObject({ status: 403 });

    expect(createJumiaCredentialServiceClient).not.toHaveBeenCalled();
    expect(mockCredentialRpc).not.toHaveBeenCalled();
  });
});
