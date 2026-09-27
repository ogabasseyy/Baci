import { describe, expect, it, vi } from 'vitest';
import { loadJumiaOrderSyncIntegrations } from './load-jumia-order-sync-integrations';

function createQuery(result: {
  data: unknown[] | null;
  error: { message: string } | null;
}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    neq: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

describe('loadJumiaOrderSyncIntegrations', () => {
  it('loads active OAuth integrations and excludes self-authorization rows', async () => {
    const query = createQuery({
      data: [{ id: 'integration-1' }],
      error: null,
    });
    const supabase = { from: vi.fn(() => query) };

    const result = await loadJumiaOrderSyncIntegrations(supabase);

    expect(result).toEqual([{ id: 'integration-1' }]);
    expect(supabase.from).toHaveBeenCalledWith('marketplace_integrations');
    expect(query.select).toHaveBeenCalledWith(
      'id, merchant_id, shop_id, marketplace_key, access_token, refresh_token, token_expires_at, last_sync_at, sync_config'
    );
    expect(query.eq).toHaveBeenNthCalledWith(1, 'platform', 'jumia');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'is_active', true);
    expect(query.neq).toHaveBeenCalledWith(
      'connection_method',
      'self_authorization'
    );
  });

  it('raises a database error instead of treating a failed lookup as empty', async () => {
    const query = createQuery({
      data: null,
      error: { message: 'temporary database failure' },
    });

    await expect(
      loadJumiaOrderSyncIntegrations({ from: () => query })
    ).rejects.toThrow('temporary database failure');
  });
});
