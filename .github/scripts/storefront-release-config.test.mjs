import assert from 'node:assert/strict';
import test from 'node:test';
import { readReleaseConfig } from './storefront-release-config.mjs';

test('binds release coherence to the normalized prebuilt deployment marker', () => {
  const config = readReleaseConfig({
    BACI_NEXT_DEPLOYMENT_ID_SOURCE:
      '28113940786_2_4ed230c08d512b42aed6824b19c2427710247cbf',
    CLOUDFLARE_API_TOKEN: 'token',
    CLOUDFLARE_ZONE_ID: 'zone-123',
  });

  assert.equal(config.expectedMarker, '28113940786_2_4ed230c08d512b42ae');
});

test('reads bounded settings for the hostname-purge fallback verification window', () => {
  const base = {
    BACI_NEXT_DEPLOYMENT_ID_SOURCE: '28113940786_2_4ed230c08d512b42aed6824b19c2427710247cbf',
    CLOUDFLARE_API_TOKEN: 'token',
    CLOUDFLARE_ZONE_ID: 'zone-123',
  };

  const defaults = readReleaseConfig(base);
  assert.equal(defaults.escalationAttempts, 8);
  assert.equal(defaults.escalationRetryDelayMs, 5_000);

  const tuned = readReleaseConfig({
    ...base,
    STOREFRONT_RELEASE_ESCALATION_ATTEMPTS: '3',
    STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS: '250',
  });
  assert.equal(tuned.escalationAttempts, 3);
  assert.equal(tuned.escalationRetryDelayMs, 250);

  assert.throws(
    () => readReleaseConfig({ ...base, STOREFRONT_RELEASE_ESCALATION_ATTEMPTS: '11' }),
    /STOREFRONT_RELEASE_ESCALATION_ATTEMPTS must be an integer between 1 and 10/
  );
  assert.throws(
    () => readReleaseConfig({ ...base, STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS: '30001' }),
    /STOREFRONT_RELEASE_ESCALATION_RETRY_DELAY_MS must be an integer between 1 and 30000/
  );
});
