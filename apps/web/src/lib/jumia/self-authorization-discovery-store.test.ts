import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

const mockSupabase = {
  rpc: (...args: unknown[]) => mockRpc(...args),
} as unknown as import('@supabase/supabase-js').SupabaseClient;

import {
  claimJumiaSelfAuthorizationDiscovery,
  consumeJumiaSelfAuthorizationDiscovery,
  createJumiaSelfAuthorizationDiscovery,
  loadJumiaSelfAuthorizationDiscovery,
  preserveJumiaSelfAuthorizationDiscoveryAfterRotation,
  releaseJumiaSelfAuthorizationDiscovery,
  updateClaimedJumiaSelfAuthorizationDiscovery,
} from './self-authorization-discovery-store';

describe('jumia self-authorization discovery store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a discovery record through the authenticated RPC', async () => {
    mockRpc.mockResolvedValueOnce({
      data: '00000000-0000-4000-8000-000000000099',
      error: null,
    });

    await expect(
      createJumiaSelfAuthorizationDiscovery(mockSupabase, {
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
        credentialCiphertext: 'ciphertext',
      })
    ).resolves.toBe('00000000-0000-4000-8000-000000000099');

    expect(mockRpc).toHaveBeenCalledWith(
      'create_jumia_self_authorization_discovery',
      {
        p_merchant_id: 'merchant-1',
        p_client_key_hash: 'a'.repeat(64),
        p_credential_ciphertext: 'ciphertext',
      }
    );
  });

  it('loads a matching discovery record without consuming it', async () => {
    mockRpc.mockResolvedValueOnce({
      data: 'ciphertext',
      error: null,
    });

    await expect(
      loadJumiaSelfAuthorizationDiscovery(mockSupabase, {
        discoveryId: '00000000-0000-4000-8000-000000000099',
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
      })
    ).resolves.toBe('ciphertext');

    expect(mockRpc).toHaveBeenCalledWith(
      'load_jumia_self_authorization_discovery',
      {
        p_discovery_id: '00000000-0000-4000-8000-000000000099',
        p_merchant_id: 'merchant-1',
        p_client_key_hash: 'a'.repeat(64),
      }
    );
  });

  it('retries discovery persistence after a transient RPC failure', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: new Error('temporary outage'),
      })
      .mockResolvedValueOnce({
        data: '00000000-0000-4000-8000-000000000099',
        error: null,
      });

    await expect(
      createJumiaSelfAuthorizationDiscovery(mockSupabase, {
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
        credentialCiphertext: 'ciphertext',
      })
    ).resolves.toBe('00000000-0000-4000-8000-000000000099');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('consumes a matching discovery record once through the authenticated RPC', async () => {
    mockRpc.mockResolvedValueOnce({
      data: 'ciphertext',
      error: null,
    });

    await expect(
      consumeJumiaSelfAuthorizationDiscovery(mockSupabase, {
        discoveryId: '00000000-0000-4000-8000-000000000099',
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
        claimToken: '00000000-0000-4000-8000-000000000088',
      })
    ).resolves.toBe('ciphertext');

    expect(mockRpc).toHaveBeenCalledWith(
      'consume_jumia_self_authorization_discovery',
      {
        p_discovery_id: '00000000-0000-4000-8000-000000000099',
        p_merchant_id: 'merchant-1',
        p_client_key_hash: 'a'.repeat(64),
        p_claim_token: '00000000-0000-4000-8000-000000000088',
      }
    );
  });

  it('claims a discovery before returning its credential ciphertext', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        claim_token: '00000000-0000-4000-8000-000000000088',
        credential_ciphertext: 'ciphertext',
      },
      error: null,
    });

    await expect(
      claimJumiaSelfAuthorizationDiscovery(mockSupabase, {
        discoveryId: '00000000-0000-4000-8000-000000000099',
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
      })
    ).resolves.toEqual({
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'ciphertext',
    });
  });

  it('updates rotated credentials and releases recoverable claims', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await updateClaimedJumiaSelfAuthorizationDiscovery(mockSupabase, {
      discoveryId: '00000000-0000-4000-8000-000000000099',
      merchantId: 'merchant-1',
      claimToken: '00000000-0000-4000-8000-000000000088',
      credentialCiphertext: 'rotated-ciphertext',
    });
    await releaseJumiaSelfAuthorizationDiscovery(mockSupabase, {
      discoveryId: '00000000-0000-4000-8000-000000000099',
      merchantId: 'merchant-1',
      claimToken: '00000000-0000-4000-8000-000000000088',
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'update_claimed_jumia_self_authorization_discovery',
      expect.objectContaining({
        p_credential_ciphertext: 'rotated-ciphertext',
      })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'release_jumia_self_authorization_discovery',
      expect.objectContaining({
        p_claim_token: '00000000-0000-4000-8000-000000000088',
      })
    );
  });

  it('creates a new recovery record when a claimed rotation cannot be updated', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({
        data: '00000000-0000-4000-8000-000000000077',
        error: null,
      });

    await expect(
      preserveJumiaSelfAuthorizationDiscoveryAfterRotation(mockSupabase, {
        discoveryId: '00000000-0000-4000-8000-000000000099',
        merchantId: 'merchant-1',
        clientKeyHash: 'a'.repeat(64),
        claimToken: '00000000-0000-4000-8000-000000000088',
        credentialCiphertext: 'rotated-ciphertext',
      })
    ).resolves.toBe('00000000-0000-4000-8000-000000000077');

    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'create_jumia_self_authorization_discovery',
      expect.objectContaining({
        p_credential_ciphertext: 'rotated-ciphertext',
      })
    );
  });
});
