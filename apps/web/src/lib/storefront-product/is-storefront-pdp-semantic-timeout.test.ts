import { describe, expect, it } from 'vitest';
import { isStorefrontPdpSemanticTimeout } from './is-storefront-pdp-semantic-timeout';

describe('isStorefrontPdpSemanticTimeout', () => {
  it('recognizes timeout names and messages', () => {
    expect(isStorefrontPdpSemanticTimeout({ name: 'TimeoutError' })).toBe(true);
    expect(isStorefrontPdpSemanticTimeout(new Error('request timed out'))).toBe(
      true
    );
  });
  it('rejects unrelated values', () => {
    expect(isStorefrontPdpSemanticTimeout(new Error('bad request'))).toBe(
      false
    );
    expect(isStorefrontPdpSemanticTimeout(null)).toBe(false);
  });
});
