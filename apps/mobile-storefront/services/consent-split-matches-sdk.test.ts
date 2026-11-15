import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

/**
 * prepareQuizMobileAdsConsent() runs requestInfoUpdate() and then
 * loadAndShowConsentFormIfRequired() itself instead of calling
 * AdsConsent.gatherConsent(), so it can report which stage it is in. This
 * guard fails when an SDK upgrade changes what gatherConsent() does, so the
 * split gets re-checked rather than silently drifting.
 */
describe('consent split matches the SDK gatherConsent()', () => {
  it('gatherConsent() is exactly requestInfoUpdate() then loadAndShowConsentFormIfRequired()', () => {
    const packageJson = require.resolve(
      'react-native-google-mobile-ads/package.json'
    );
    const source = readFileSync(
      join(dirname(packageJson), 'src', 'AdsConsent.ts'),
      'utf8'
    );
    const start = source.indexOf('async gatherConsent(');
    expect(start).toBeGreaterThan(-1);
    // The method ends at the next top-level member of the AdsConsent object.
    const body = source
      .slice(start)
      .split(/\n {2}[a-zA-Z]+\(/)[0]
      .replace(/\/\/.*$/gm, '');

    const update = body.indexOf('requestInfoUpdate(');
    const form = body.indexOf('loadAndShowConsentFormIfRequired(');
    expect(update).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(update);
    // No other consent-related calls were added around the pair.
    expect(body.match(/this\.\w+\(/g)).toEqual([
      'this.requestInfoUpdate(',
      'this.loadAndShowConsentFormIfRequired(',
    ]);
  });
});
