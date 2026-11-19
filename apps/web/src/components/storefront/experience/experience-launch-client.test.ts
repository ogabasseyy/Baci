import { beforeEach, expect, it, vi } from 'vitest';

const csrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: csrf }));

import {
  readExperiencePublicationState,
  renewExperienceLaunch,
} from './experience-launch-client';

beforeEach(() => {
  vi.clearAllMocks();
});
it('uses the existing CSRF transport for anonymous initial launch and renewal, retaining the root-host hint', async () => {
  csrf.mockResolvedValue(
    Response.json({
      buildDigest: 'a'.repeat(64),
      policyRevision: 'p',
      catalogRevision: 'r',
      expiresAt: Date.now() + 1800000,
    })
  );
  const result = await renewExperienceLaunch(
    '/api/storefront/experience/state?merchantSlug=qa1&buildDigest=' +
      'a'.repeat(64) +
      '&path=%2Fpages%2Fstory'
  );
  expect(result.catalogRevision).toBe('r');
  const [url, init] = csrf.mock.calls[0];
  expect(new URL(url).pathname).toBe('/api/storefront/experience/launch');
  expect(new URL(url).searchParams.get('merchantSlug')).toBe('qa1');
  expect(JSON.parse(init.body)).toEqual({
    buildDigest: 'a'.repeat(64),
    path: '/pages/story',
  });
  expect(init).toMatchObject({ method: 'POST', referrerPolicy: 'same-origin' });
});
it('rejects cross-origin launch URLs before transport and fails on unknown state', async () => {
  await expect(
    renewExperienceLaunch('https://other.test/api/storefront/experience/state')
  ).rejects.toThrow('INVALID_STATE_URL');
  expect(csrf).not.toHaveBeenCalled();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
  );
  await expect(
    readExperiencePublicationState('/api/storefront/experience/state')
  ).rejects.toThrow('STATE_UNAVAILABLE');
  vi.unstubAllGlobals();
});
