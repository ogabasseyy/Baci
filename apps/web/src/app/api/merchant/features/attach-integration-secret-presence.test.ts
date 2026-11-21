import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { attachIntegrationSecretPresence } from './attach-integration-secret-presence';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

function clientWith(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('attachIntegrationSecretPresence', () => {
  it('adds configured flags, nulls the values and keeps other fields', async () => {
    const { client, rpc } = clientWith({
      data: {
        facebook_capi_token: true,
        tiktok_access_token: false,
        snapchat_capi_token: false,
        ga4_api_secret: true,
      },
      error: null,
    });

    const result = await attachIntegrationSecretPresence(client, MERCHANT_ID, {
      merchant_id: MERCHANT_ID,
      reviews_enabled: true,
    });

    expect(rpc).toHaveBeenCalledWith(
      'get_merchant_integration_secret_presence',
      {
        p_merchant_id: MERCHANT_ID,
      }
    );
    expect(result).toMatchObject({
      merchant_id: MERCHANT_ID,
      reviews_enabled: true,
      facebook_capi_token: null,
      facebook_capi_token_configured: true,
      tiktok_access_token_configured: false,
      snapchat_capi_token_configured: false,
      ga4_api_secret: null,
      ga4_api_secret_configured: true,
    });
  });

  it('treats a missing key as not configured', async () => {
    const { client } = clientWith({ data: {}, error: null });
    const result = await attachIntegrationSecretPresence(
      client,
      MERCHANT_ID,
      {}
    );
    expect(result).toMatchObject({ facebook_capi_token_configured: false });
  });

  it('returns null when the presence lookup errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientWith({ data: null, error: { message: 'boom' } });
    expect(
      await attachIntegrationSecretPresence(client, MERCHANT_ID, {})
    ).toBeNull();
    spy.mockRestore();
  });

  it('returns null when the caller has no access (function returns null)', async () => {
    const { client } = clientWith({ data: null, error: null });
    expect(
      await attachIntegrationSecretPresence(client, MERCHANT_ID, {})
    ).toBeNull();
  });
});
