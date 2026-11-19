import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { saveZohoRefreshToken } from './save-zoho-refresh-token';

function clientWith(error: { code?: string; message: string } | null) {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('saveZohoRefreshToken', () => {
  it('does nothing when no token was supplied', async () => {
    const { client, rpc } = clientWith(null);
    expect(await saveZohoRefreshToken(client, 'm1', undefined)).toEqual({
      ok: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears the stored token when told null (blank value to the function)', async () => {
    const { client, rpc } = clientWith(null);
    expect(await saveZohoRefreshToken(client, 'm1', null)).toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith('set_merchant_zoho_refresh_token', {
      p_merchant_id: 'm1',
      p_refresh_token: '',
    });
  });

  it('saves through the permission-checked function', async () => {
    const { client, rpc } = clientWith(null);
    expect(await saveZohoRefreshToken(client, 'm1', 'tok')).toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith('set_merchant_zoho_refresh_token', {
      p_merchant_id: 'm1',
      p_refresh_token: 'tok',
    });
  });

  it('maps a permission failure to 403', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientWith({ code: '42501', message: 'nope' });
    expect(await saveZohoRefreshToken(client, 'm1', 'tok')).toEqual({
      ok: false,
      status: 403,
    });
    spy.mockRestore();
  });

  it('maps a rejected value (22023) to 400', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientWith({ code: '22023', message: 'too long' });
    expect(await saveZohoRefreshToken(client, 'm1', 'x'.repeat(5000))).toEqual({
      ok: false,
      status: 400,
    });
    spy.mockRestore();
  });

  it('maps any other failure to 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientWith({ code: 'XX000', message: 'boom' });
    expect(await saveZohoRefreshToken(client, 'm1', 'tok')).toEqual({
      ok: false,
      status: 500,
    });
    spy.mockRestore();
  });
});
