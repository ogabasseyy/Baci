import { describe, expect, it, vi } from 'vitest';
import {
  extractRenamedSlugResult,
  hasEstablishedOnboardingSlug,
  isRenameSlugUnavailableError,
  resolveOnboardingMerchantSlug,
} from './onboarding-slug';

describe('resolveOnboardingMerchantSlug', () => {
  it('uses the local normalized slug when the database resolver has no value', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      resolveOnboardingMerchantSlug({ rpc }, 'Baci Food 123')
    ).resolves.toBe('baci-food-123');
    expect(hasEstablishedOnboardingSlug('merchant-chosen-slug')).toBe(true);
    expect(hasEstablishedOnboardingSlug('   ')).toBe(false);
    expect(hasEstablishedOnboardingSlug(null)).toBe(false);
  });

  it('keeps the database-issued slug for a collision-safe result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'baci-food-2', error: null });

    await expect(
      resolveOnboardingMerchantSlug({ rpc }, 'Baci Food')
    ).resolves.toBe('baci-food-2');
  });

  it('classifies only explicit rename_merchant_slug unavailable error keys and not arbitrary 23505s', () => {
    expect(
      isRenameSlugUnavailableError({ code: '23505', message: 'slug_taken' })
    ).toBe(true);
    expect(
      isRenameSlugUnavailableError({ code: '22023', message: 'reserved_slug' })
    ).toBe(true);
    expect(
      isRenameSlugUnavailableError({ code: '22023', message: 'invalid_slug' })
    ).toBe(true);
    expect(
      isRenameSlugUnavailableError({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "domains_pkey"',
      })
    ).toBe(false);
  });

  it('preserves explicit retired_slug: null from a no-op rename RPC instead of fabricating previousSlug', () => {
    expect(
      extractRenamedSlugResult(
        { slug: 'same-slug', retired_slug: null },
        'fallback',
        'previous-slug'
      )
    ).toEqual({
      finalSlug: 'same-slug',
      retiredSlug: null,
    });
    expect(extractRenamedSlugResult(null, 'fallback', 'previous-slug')).toEqual(
      {
        finalSlug: 'fallback',
        retiredSlug: 'previous-slug',
      }
    );
  });
});
