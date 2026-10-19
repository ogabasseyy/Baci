import { describe, expect, it, vi } from 'vitest';
import { persistJumiaOAuthExchangeIntegrations } from './persist-jumia-oauth-exchange-integrations';

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
  token_expires_at: '2026-08-22T00:00:00.000Z',
  is_active: true,
  jumia_authorization_id: null,
  sync_config: { orders: true },
};

describe('persistJumiaOAuthExchangeIntegrations', () => {
  it('retries transient atomic persistence failures before succeeding', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'reset' } })
      .mockResolvedValueOnce({ data: true, error: null });

    const result = await persistJumiaOAuthExchangeIntegrations({
      supabase: { rpc } as never,
      integrationRows: [row],
    });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('returns the last persistence error after exhausting retries', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'persistence failed' },
    });

    const result = await persistJumiaOAuthExchangeIntegrations({
      supabase: { rpc } as never,
      integrationRows: [row],
    });

    expect(result).toEqual({
      ok: false,
      error: { message: 'persistence failed' },
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
