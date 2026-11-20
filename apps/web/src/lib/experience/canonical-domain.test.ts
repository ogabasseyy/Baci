import { expect, it, vi } from 'vitest';
import { resolveCanonicalBase } from './canonical-domain';

it('resolves a merchant at the DNS label limit', async () => {
  const slug = 'a'.repeat(63);
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  await expect(
    resolveCanonicalBase({ rpc } as never, slug, 'usebaci.com')
  ).resolves.toBe(`https://${slug}.usebaci.com`);
  expect(rpc).toHaveBeenCalledWith('resolve_storefront_custom_domain', {
    p_slug: slug,
  });
});

it.each([
  'a'.repeat(64),
  'store-',
])('rejects a slug that cannot be used as a DNS label before resolving it', async (slug) => {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  await expect(
    resolveCanonicalBase({ rpc } as never, slug, 'usebaci.com')
  ).rejects.toThrow('INVALID_MERCHANT_SLUG');
  expect(rpc).not.toHaveBeenCalled();
});
