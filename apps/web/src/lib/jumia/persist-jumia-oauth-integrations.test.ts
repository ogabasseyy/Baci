import { describe, expect, it, vi } from 'vitest';
import { persistJumiaOAuthIntegrations } from './persist-jumia-oauth-integrations';

const row = {
  merchant_id: 'merchant-1',
  platform: 'jumia' as const,
  shop_id: 'shop-1',
  marketplace_key: 'oauth',
  connection_method: 'oauth' as const,
  shop_name: 'Shop',
  country_code: 'NG',
  access_token: 'access',
  refresh_token: 'refresh',
  token_expires_at: '2026-08-25T18:00:00.000Z',
  is_active: true,
  jumia_authorization_id: null,
  sync_config: { orders: true },
};

describe('persistJumiaOAuthIntegrations', () => {
  it('persists the batch through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      persistJumiaOAuthIntegrations({ rpc } as never, [row])
    ).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      'persist_jumia_oauth_integrations_atomically',
      { p_merchant_id: 'merchant-1', p_integrations: [row] }
    );
  });

  it('returns the final RPC error after bounded retries', async () => {
    const error = { message: 'serialization failure' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(
      persistJumiaOAuthIntegrations({ rpc } as never, [row])
    ).resolves.toEqual({ ok: false, error });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
