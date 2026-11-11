// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn() }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));

import { resolvePublishedExperienceRequest } from './published-request-context';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'qa1',
  business_name: 'Synthetic',
  custom_domain: null,
  is_published: true,
};
const deps = () => ({
  rootDomain: 'usebaci.com',
  resolveAlias: async () => null,
  rpcClient: { rpc: vi.fn(async () => ({ data: [row], error: null })) },
});
it('retains main root/www Referer validation and its non-production local hint policy without cart enrollment', async () => {
  for (const origin of [
    'https://usebaci.com',
    'https://www.usebaci.com',
    'http://localhost:43174',
    'http://127.0.0.1:43174',
  ]) {
    const request = new Request(
      `${origin}/api/storefront/experience/state?merchantSlug=qa1`,
      { headers: { referer: `${origin}/qa1/pages/story` } }
    );
    expect((await resolvePublishedExperienceRequest(request, deps())).ok).toBe(
      true
    );
    if (origin.startsWith('https:'))
      expect(
        (
          await resolvePublishedExperienceRequest(
            new Request(request.url),
            deps()
          )
        ).ok
      ).toBe(false);
    else
      expect(
        (
          await resolvePublishedExperienceRequest(
            new Request(request.url),
            deps()
          )
        ).ok
      ).toBe(true);
    if (origin.startsWith('https:'))
      expect(
        (
          await resolvePublishedExperienceRequest(
            new Request(request.url, {
              headers: { referer: 'https://other.test/qa1' },
            }),
            deps()
          )
        ).ok
      ).toBe(false);
  }
});
it('rejects mismatched subdomain headers, forwarded host, unpublished and cross-merchant hints', async () => {
  expect(
    (
      await resolvePublishedExperienceRequest(
        new Request(
          'https://attacker.usebaci.com/api/storefront/experience/state',
          {
            headers: {
              'x-merchant-slug': 'qa1',
              'x-forwarded-host': 'qa1.usebaci.com',
            },
          }
        ),
        deps()
      )
    ).ok
  ).toBe(false);
  const unpublished = deps();
  unpublished.rpcClient.rpc.mockResolvedValue({
    data: [{ ...row, is_published: false }],
    error: null,
  });
  expect(
    (
      await resolvePublishedExperienceRequest(
        new Request('https://qa1.usebaci.com/api/storefront/experience/state'),
        unpublished
      )
    ).ok
  ).toBe(false);
});
