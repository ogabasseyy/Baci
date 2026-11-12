import { expect, it } from 'vitest';
import { isChatwootBridgeFixtureRequest } from './chatwoot-bridge-request-allowlist';

it('limits Chatwoot harness traffic to exact origins, paths, methods, and queries', () => {
  const harnessOrigin = 'http://127.0.0.1:3217';
  const request = (url: string, method: string, fixtureVisited = true) =>
    isChatwootBridgeFixtureRequest({
      url,
      method,
      harnessOrigin,
      fixtureVisited,
    });

  expect(request(`${harnessOrigin}/chatwoot-bridge`, 'GET', false)).toBe(true);
  expect(request(`${harnessOrigin}/chatwoot-bridge?anything=1`, 'GET')).toBe(
    false
  );
  for (const origin of [
    'https://support.example.test',
    'https://untrusted.example.test',
  ])
    expect(request(`${origin}/widget`, 'GET')).toBe(true);
  expect(request('https://support.example.test/widget?anything=1', 'GET')).toBe(
    false
  );
  for (const endpoint of ['challenge', 'verify', 'authorize'])
    expect(
      request(
        `${harnessOrigin}/api/storefront/chatwoot/context/${endpoint}?merchantSlug=ogabassey`,
        'POST'
      )
    ).toBe(true);

  expect(request('https://other.example.test/widget', 'GET')).toBe(false);
  expect(request('https://support.example.test/other', 'GET')).toBe(false);
  expect(request('https://support.example.test/widget', 'POST')).toBe(false);
  expect(
    request(`${harnessOrigin}/api/storefront/chatwoot/context/other`, 'POST')
  ).toBe(false);
  expect(
    request(`${harnessOrigin}/api/storefront/chatwoot/context/challenge`, 'GET')
  ).toBe(false);
  expect(
    request(
      `${harnessOrigin}/api/storefront/chatwoot/context/challenge?merchantSlug=other`,
      'POST'
    )
  ).toBe(false);
  expect(
    request(
      `${harnessOrigin}/api/storefront/chatwoot/context/challenge?merchantSlug=ogabassey&extra=1`,
      'POST'
    )
  ).toBe(false);
  expect(request('https://support.example.test/widget', 'GET', false)).toBe(
    false
  );
  expect(
    request(
      `${harnessOrigin}/api/storefront/chatwoot/context/challenge`,
      'POST',
      false
    )
  ).toBe(false);
});
