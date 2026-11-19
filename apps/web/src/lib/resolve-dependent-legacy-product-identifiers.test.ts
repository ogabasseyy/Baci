import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveDependentLegacyProductIdentifiers } from './resolve-dependent-legacy-product-identifiers';

function createSupabaseMock(result: { data: unknown; error: unknown } | Error) {
  const limit = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  const eqParent = vi.fn(() => ({ limit }));
  const eqMerchant = vi.fn(() => ({ eq: eqParent }));
  const select = vi.fn(() => ({ eq: eqMerchant }));
  return {
    from: vi.fn(() => ({ select })),
  } as unknown as SupabaseClient;
}

describe('resolveDependentLegacyProductIdentifiers', () => {
  it('collects unique child ids and slugs when lookup is bounded and clean', async () => {
    const supabase = createSupabaseMock({
      data: [
        { id: 'child-1', slug: 'old-iphone-64' },
        { id: 'child-2', slug: '  ' },
        { id: 'child-1', slug: 'old-iphone-64' },
      ],
      error: null,
    });

    await expect(
      resolveDependentLegacyProductIdentifiers(
        supabase,
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({
      identifiers: ['child-1', 'old-iphone-64', 'child-2'],
      incomplete: false,
    });
  });

  it('marks incomplete when the query errors, rejects, or hits the 256 limit', async () => {
    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock({ data: null, error: { message: 'db down' } }),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });

    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock(new Error('network failure')),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });

    const limitRows = Array.from({ length: 256 }, (_, index) => ({
      id: `child-${index}`,
      slug: `slug-${index}`,
    }));
    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock({ data: limitRows, error: null }),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });
  });

  it('fails closed when query data or row fields are malformed', async () => {
    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock({ data: 'not-an-array', error: null }),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });

    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock({ data: [null], error: null }),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });

    await expect(
      resolveDependentLegacyProductIdentifiers(
        createSupabaseMock({ data: [{ id: 123, slug: 'ok' }], error: null }),
        'merchant-1',
        'parent-1'
      )
    ).resolves.toEqual({ identifiers: [], incomplete: true });
  });
});
