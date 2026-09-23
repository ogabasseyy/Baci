import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCustomDomain, fetchSlugForDomain } from './domain-cache-database';

function createQuery(result: unknown) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    select: vi.fn(() => query),
  };
  return query;
}

describe('domain cache database fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the active primary custom domain for a merchant slug', async () => {
    const query = createQuery({
      data: {
        id: 'merchant-1',
        domains: [
          {
            domain: 'shop.example.com',
            is_primary: true,
            status: 'active',
            domain_type: 'custom',
          },
        ],
      },
      error: null,
    });
    const client = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient;

    await expect(fetchCustomDomain(client, 'shop')).resolves.toBe(
      'shop.example.com'
    );
  });

  it('returns the merchant slug for an active custom domain', async () => {
    const query = createQuery({
      data: { merchants: { slug: 'shop' } },
      error: null,
    });
    const client = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient;

    await expect(fetchSlugForDomain(client, 'shop.example.com')).resolves.toBe(
      'shop'
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('fails open when the database lookup rejects', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('database unavailable');
      }),
    } as unknown as SupabaseClient;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      fetchSlugForDomain(client, 'shop.example.com')
    ).resolves.toBeNull();
    await expect(fetchCustomDomain(client, 'shop')).resolves.toBeNull();
    errorSpy.mockRestore();
  });

  it('fails open when database results are missing or contain an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missingQuery = createQuery({ data: null, error: null });
    const errorQuery = createQuery({
      data: null,
      error: { message: 'database unavailable' },
    });
    const missingClient = {
      from: vi.fn(() => missingQuery),
    } as unknown as SupabaseClient;
    const errorClient = {
      from: vi.fn(() => errorQuery),
    } as unknown as SupabaseClient;

    await expect(
      fetchSlugForDomain(missingClient, 'missing.example.com')
    ).resolves.toBeNull();
    await expect(fetchCustomDomain(errorClient, 'missing')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('does not guess when multiple active domains have no primary', async () => {
    const query = createQuery({
      data: {
        id: 'merchant-1',
        domains: [
          {
            domain: 'one.example.com',
            is_primary: false,
            status: 'active',
            domain_type: 'custom',
          },
          {
            domain: 'two.example.com',
            is_primary: false,
            status: 'active',
            domain_type: 'purchased',
          },
        ],
      },
      error: null,
    });
    const client = {
      from: vi.fn(() => query),
    } as unknown as SupabaseClient;

    await expect(fetchCustomDomain(client, 'shop')).resolves.toBeNull();
  });

  it('treats a nullable primary flag as non-primary for a lone active domain', async () => {
    const query = createQuery({
      data: {
        id: 'merchant-1',
        domains: [
          {
            domain: 'nullable-primary.example.com',
            is_primary: null,
            status: 'active',
            domain_type: 'custom',
          },
        ],
      },
      error: null,
    });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    await expect(fetchCustomDomain(client, 'shop')).resolves.toBe(
      'nullable-primary.example.com'
    );
  });

  it('ignores malformed joined domain rows without throwing', async () => {
    const query = createQuery({
      data: {
        id: 'merchant-1',
        domains: [
          null,
          { domain: 'missing-fields.example.com', status: 'active' },
          {
            domain: 'valid.example.com',
            is_primary: true,
            status: 'active',
            domain_type: 'custom',
          },
        ],
      },
      error: null,
    });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    await expect(fetchCustomDomain(client, 'shop')).resolves.toBe(
      'valid.example.com'
    );
  });
});
