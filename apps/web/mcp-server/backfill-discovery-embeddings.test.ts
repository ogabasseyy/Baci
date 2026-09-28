import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillDiscoveryEmbeddings } from './backfill-discovery-embeddings';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  embedDiscoveryText: vi.fn(async () => Array(768).fill(0.1)),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('./gemini-discovery-embedding', () => ({ embedDiscoveryText: mocks.embedDiscoveryText }));

const merchantJwt = `header.${Buffer.from(JSON.stringify({
  role: 'authenticated', sub: '33333333-3333-4333-8333-333333333333',
})).toString('base64url')}.signature`;

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_ACCESS_TOKEN: merchantJwt,
  GEMINI_API_KEY: 'test-gemini-key',
  MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('merchant-authenticated discovery backfill', () => {
  it('generates and writes an active product vector under the merchant JWT', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const productQuery = {
      eq: vi.fn(() => productQuery), order: vi.fn(() => productQuery),
      range: vi.fn(async () => ({ data: [{
        id: '22222222-2222-4222-8222-222222222222',
        merchant_id: environment.MERCHANT_ID,
        name: 'Redmi 15', brand: 'Xiaomi', category: 'Smartphones',
        description: 'A phone',
      }], error: null })),
    };
    const embeddingQuery = {
      eq: vi.fn(() => embeddingQuery),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const upsert = vi.fn(async () => ({ error: null }));
    mocks.createClient.mockReturnValue({ from: vi.fn((table: string) => ({
      select: vi.fn(() => table === 'products' ? productQuery : embeddingQuery),
      upsert,
    })) });

    await backfillDiscoveryEmbeddings();

    expect(mocks.createClient).toHaveBeenCalledWith(
      environment.NEXT_PUBLIC_SUPABASE_URL, environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({ global: { headers: { Authorization: `Bearer ${merchantJwt}` } } })
    );
    expect(mocks.embedDiscoveryText).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'document', title: 'Redmi 15',
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      merchant_id: environment.MERCHANT_ID, model: 'gemini-embedding-2',
      source_hash: 'efaa6bb39d16832e5ef7a42fd212e182b9bdb183a1c25c2bc976bc266bf4ad9a',
    }));
  });

  it('rejects malformed backfill limits before reading products', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv('MAX_PRODUCTS', 'not-a-number');
    await expect(backfillDiscoveryEmbeddings()).rejects.toThrow('MAX_PRODUCTS');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects service-role and non-JWT tokens before creating a client', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    for (const token of [
      'management-token',
      `header.${Buffer.from(JSON.stringify({ role: 'service_role', sub: 'operator' })).toString('base64url')}.signature`,
    ]) {
      vi.stubEnv('SUPABASE_ACCESS_TOKEN', token);
      await expect(backfillDiscoveryEmbeddings()).rejects.toThrow('merchant user JWT');
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('regenerates a vector when its embedded source fields change', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const productQuery = {
      eq: vi.fn(() => productQuery), order: vi.fn(() => productQuery),
      range: vi.fn(async () => ({ data: [{
        id: '22222222-2222-4222-8222-222222222222', merchant_id: environment.MERCHANT_ID,
        name: 'Redmi 15', brand: null, category: null, description: null,
      }], error: null })),
    };
    const embeddingQuery = {
      eq: vi.fn(() => embeddingQuery),
      maybeSingle: vi.fn(async () => ({
        data: { source_hash: '0'.repeat(64) }, error: null,
      })),
    };
    const upsert = vi.fn(async () => ({ error: null }));
    mocks.createClient.mockReturnValue({ from: vi.fn((table: string) => ({
      select: vi.fn(() => table === 'products' ? productQuery : embeddingQuery), upsert,
    })) });

    await backfillDiscoveryEmbeddings();

    expect(mocks.embedDiscoveryText).toHaveBeenCalledOnce();
    expect(mocks.embedDiscoveryText).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Redmi 15', text: 'Redmi 15',
    }));
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('skips an unchanged vector regardless of unrelated product updates', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const productQuery = {
      eq: vi.fn(() => productQuery), order: vi.fn(() => productQuery),
      range: vi.fn(async () => ({ data: [{
        id: '22222222-2222-4222-8222-222222222222', merchant_id: environment.MERCHANT_ID,
        name: 'Legacy Camera', brand: null, category: 'Accessories',
        description: null,
      }], error: null })),
    };
    const embeddingQuery = {
      eq: vi.fn(() => embeddingQuery),
      maybeSingle: vi.fn(async () => ({
        data: { source_hash: 'b12810a0873bab52fa5a576cebb391ee403f73744674aaa914aeda20dfcecf57' }, error: null,
      })),
    };
    const upsert = vi.fn(async () => ({ error: null }));
    mocks.createClient.mockReturnValue({ from: vi.fn((table: string) => ({
      select: vi.fn(() => table === 'products' ? productQuery : embeddingQuery), upsert,
    })) });

    await backfillDiscoveryEmbeddings();

    expect(mocks.embedDiscoveryText).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
