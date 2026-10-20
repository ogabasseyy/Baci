import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { RedvaultLivePilotPolicy } from './redvault-live-pilot';
import { verifyRedvaultLivePilotDatabasePolicy } from './redvault-live-pilot-database-policy';

const policy: RedvaultLivePilotPolicy = {
  enabled: true,
  audience: 'public_product_test',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  productId: '11111111-1111-4111-8111-111111111111',
  expiresAt: null,
  maxAttempts: null,
};
const row = {
  enabled: true,
  audience: 'public_product_test',
  merchant_id: policy.merchantId,
  product_id: policy.productId,
  expires_at: null,
};

describe('verifyRedvaultLivePilotDatabasePolicy', () => {
  function clientFor(data: unknown, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { rpc } as unknown as SupabaseClient;
  }

  it('accepts exactly matching explicit public DB and server bindings', async () => {
    const client = clientFor([row]);
    expect(
      await verifyRedvaultLivePilotDatabasePolicy({ client, policy })
    ).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'get_storefront_redvault_live_pilot_policy'
    );
  });

  it.each(
    [
      null,
      [],
      [row, row],
      [{ ...row, enabled: false }],
      [{ ...row, enabled: 'true' }],
      [{ ...row, audience: 'private_user' }],
      [{ ...row, audience: undefined }],
      [{ ...row, merchant_id: 'other' }],
      [{ ...row, product_id: 'other' }],
      [{ ...row, expires_at: '2030-01-01T00:00:00Z' }],
      [{ ...row, expires_at: undefined }],
    ].map((data) => [data])
  )('fails closed on a missing or mismatched DB policy %j', async (data) => {
    expect(
      await verifyRedvaultLivePilotDatabasePolicy({
        client: clientFor(data),
        policy,
      })
    ).toBe(false);
  });

  it('fails closed on RPC errors and exceptions', async () => {
    expect(
      await verifyRedvaultLivePilotDatabasePolicy({
        client: clientFor([row], { message: 'denied' }),
        policy,
      })
    ).toBe(false);
    const client = clientFor([row]);
    vi.mocked(client.rpc).mockRejectedValue(new Error('unavailable'));
    expect(
      await verifyRedvaultLivePilotDatabasePolicy({ client, policy })
    ).toBe(false);
  });
});
