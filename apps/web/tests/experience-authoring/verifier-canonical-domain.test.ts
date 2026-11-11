import { expect, it, vi } from 'vitest';
import { resolveVerifierCanonicalBase } from '../../tools/experience-verifier/canonical-domain';

it('uses the active custom domain or the normal Baci merchant subdomain', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: 'shop.example.com', error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  const client = { rpc };
  await expect(
    resolveVerifierCanonicalBase(client as never, 'synthetic', 'usebaci.com')
  ).resolves.toBe('https://shop.example.com');
  await expect(
    resolveVerifierCanonicalBase(client as never, 'synthetic', 'usebaci.com')
  ).resolves.toBe('https://synthetic.usebaci.com');
  expect(rpc).toHaveBeenCalledWith('resolve_storefront_custom_domain', {
    p_slug: 'synthetic',
  });
});
it('fails closed on a failed lookup, unsafe hostname or invalid slug', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
    .mockResolvedValueOnce({ data: 'evil.test/path', error: null });
  await expect(
    resolveVerifierCanonicalBase({ rpc } as never, 'synthetic', 'usebaci.com')
  ).rejects.toThrow();
  await expect(
    resolveVerifierCanonicalBase({ rpc } as never, 'synthetic', 'usebaci.com')
  ).rejects.toThrow();
  await expect(
    resolveVerifierCanonicalBase({ rpc } as never, '../bad', 'usebaci.com')
  ).rejects.toThrow();
});
