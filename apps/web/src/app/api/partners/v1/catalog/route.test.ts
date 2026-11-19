import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { loadCrossRemCatalog } = vi.hoisted(() => ({
  loadCrossRemCatalog: vi.fn(),
}));

vi.mock('./catalog-service', () => ({ loadCrossRemCatalog }));

const token = 'synthetic-crossrem-access-token-qa-test-0001';
const snapshot = { listings: [{ id: 'google-listed-variant' }] };

function request(authorization?: string, ifNoneMatch?: string) {
  const headers = new Headers();

  if (authorization) headers.set('authorization', authorization);
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  return new Request('https://store.test/api/partners/v1/catalog', { headers });
}

describe('CrossRem catalog', () => {
  beforeEach(() => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', token);
    loadCrossRemCatalog.mockReset().mockResolvedValue(snapshot);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects missing, malformed and short configured credentials', async () => {
    for (const configuredToken of ['', 'bad:token', 'test']) {
      vi.stubEnv('CROSSREM_CATALOG_TOKEN', configuredToken);
      const response = await GET(request(`Bearer ${configuredToken || token}`));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  it('checks authentication before loading the feed or applying a validator', async () => {
    for (const authorization of [
      undefined,
      'Bearer incorrect',
      `Basic ${token}`,
    ]) {
      const response = await GET(request(authorization, '*'));

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.has('etag')).toBe(false);
    }

    expect(loadCrossRemCatalog).not.toHaveBeenCalled();
  });

  it('returns a complete JSON snapshot and supports conditional reads', async () => {
    const response = await GET(request(`bearer ${token}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(snapshot);
    const etag = response.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const unchanged = await GET(
      request(`Bearer ${token}`, `"other", W/${etag}`)
    );
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('etag')).toBe(etag);
    expect(await unchanged.text()).toBe('');

    loadCrossRemCatalog.mockResolvedValue({ listings: [{ id: 'changed' }] });
    const changed = await GET(request(`Bearer ${token}`, etag ?? undefined));
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(await changed.json()).toEqual({ listings: [{ id: 'changed' }] });
  });

  it('hides internal details when the catalog cannot be built', async () => {
    loadCrossRemCatalog.mockRejectedValue(new Error('private storage detail'));

    const response = await GET(request(`Bearer ${token}`));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('etag')).toBe(false);
    expect(await response.json()).toEqual({
      error: 'CrossRem catalog unavailable',
    });
  });
});
