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
    const match = source.match(
      /async gatherConsent\([^)]*\)\s*\{([\s\S]*?)\n {2}\},/
    );

    expect(match).not.toBeNull();
    const body = (match?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(body).toEqual([
      'await this.requestInfoUpdate(options);',
      'return this.loadAndShowConsentFormIfRequired();',
    ]);
  });
});
