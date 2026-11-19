import { describe, expect, it, vi } from 'vitest';
import { loadXAdsConnection } from './load-connection';

function database(settings: unknown, credential: unknown, failure?: string) {
  const queries: {
    table: string;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
  }[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const query = {
        table,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'merchant_feature_settings' ? settings : credential,
          error: table === failure ? { message: 'private detail' } : null,
        }),
      };
      queries.push(query);
      return query;
    }),
  };
  return {
    client: client as unknown as Parameters<typeof loadXAdsConnection>[0],
    queries,
  };
}
describe('owner-scoped public X connection read', () => {
  it('selects only the pixel ID and credential presence, scoped to the merchant', async () => {
    const db = database(
      { twitter_pixel_id: 'pixel' },
      { merchant_id: 'owned', capi_key: 'must-not-leak' }
    );
    await expect(loadXAdsConnection(db.client, 'owned')).resolves.toEqual({
      pixelId: 'pixel',
      eventIds: {},
      capiConfigured: true,
    });
    expect(db.queries[0].select).toHaveBeenCalledWith(
      'twitter_pixel_id,twitter_event_ids'
    );
    expect(db.queries[1].select).toHaveBeenCalledWith('merchant_id');
    for (const query of db.queries)
      expect(query.eq).toHaveBeenCalledWith('merchant_id', 'owned');
  });
  it('represents a store with no saved connection', async () => {
    const db = database(null, null);
    await expect(loadXAdsConnection(db.client, 'owned')).resolves.toEqual({
      pixelId: null,
      eventIds: {},
      capiConfigured: false,
    });
  });
  it.each([
    'merchant_feature_settings',
    'merchant_x_ads_credentials',
  ])('fails safely when %s lookup fails', async (table) => {
    const db = database(null, null, table);
    await expect(loadXAdsConnection(db.client, 'owned')).rejects.toThrow(
      'x_connection_unavailable'
    );
  });
  it('rejects malformed persisted public data', async () => {
    const db = database({ twitter_pixel_id: 123 }, null);
    await expect(loadXAdsConnection(db.client, 'owned')).rejects.toThrow();
  });
});
