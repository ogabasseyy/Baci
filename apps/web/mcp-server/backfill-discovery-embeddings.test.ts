import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillDiscoveryEmbeddings } from './backfill-discovery-embeddings';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  embedDiscoveryText: vi.fn(async () => Array(768).fill(0.1)),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('./gemini-discovery-embedding', () => ({ embedDiscoveryText: mocks.embedDiscoveryText }));

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_ACCESS_TOKEN: 'merchant-jwt',
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
        description: 'A phone', updated_at: '2026-09-28T00:00:00Z',
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
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer merchant-jwt' } } })
    );
    expect(mocks.embedDiscoveryText).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'document', title: 'Redmi 15',
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      merchant_id: environment.MERCHANT_ID, model: 'gemini-embedding-2',
    }));
  });

  it('rejects malformed backfill limits before reading products', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv('MAX_PRODUCTS', 'not-a-number');
    await expect(backfillDiscoveryEmbeddings()).rejects.toThrow('MAX_PRODUCTS');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('regenerates a microsecond-stale vector without rounding timestamps', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    const productQuery = {
      eq: vi.fn(() => productQuery), order: vi.fn(() => productQuery),
      range: vi.fn(async () => ({ data: [{
        id: '22222222-2222-4222-8222-222222222222', merchant_id: environment.MERCHANT_ID,
        name: 'Redmi 15', brand: null, category: null, description: null,
        updated_at: '2026-09-28T00:00:00.123456+00:00',
      }], error: null })),
    };
    const embeddingQuery = {
      eq: vi.fn(() => embeddingQuery),
      maybeSingle: vi.fn(async () => ({
        data: { source_updated_at: '2026-09-28T00:00:00.123455+00:00' }, error: null,
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
});
