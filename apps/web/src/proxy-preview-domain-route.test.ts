import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { proxy } from './proxy';

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue('ogabassey.com'),
  getSlugForCustomDomain: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn().mockResolvedValue({ response: undefined, user: null }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

it('keeps the domain-identifier route on the preview host while the slug redirects', async () => {
  const host = 'baci-test-basseys-projects-d7395611.vercel.app';
  const request = (path: string) =>
    new NextRequest(`https://${host}${path}`, { headers: { host } });
  const slug = await proxy(request('/ogabassey'));
  expect(slug.status).toBe(301);
  expect(slug.headers.get('location')).toBe('https://ogabassey.com/');
  const domain = await proxy(request('/ogabassey.com'));
  expect(domain.status).toBe(200);
  expect(domain.headers.get('location')).toBeNull();
  expect(domain.headers.get('x-middleware-rewrite')).toBeNull();
});
