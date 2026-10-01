import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
}));

import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { resolveRetiredSlugRedirect } from './retired-slug';

describe('retired slug redirects', () => {
  it('redirects only safe methods to the current slug and preserves query', async () => {
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('new-shop');
    await expect(
      resolveRetiredSlugRedirect(
        'old-shop',
        '/products/iphone',
        '?ref=email',
        'GET'
      )
    ).resolves.toBe('https://new-shop.usebaci.com/products/iphone?ref=email');
    await expect(
      resolveRetiredSlugRedirect('old-shop', '/products/iphone', '', 'POST')
    ).resolves.toBeNull();
  });
});
