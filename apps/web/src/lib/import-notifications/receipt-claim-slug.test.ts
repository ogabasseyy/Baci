import { describe, expect, it } from 'vitest';
import { isSafeClaimSlug } from './receipt-claim-slug';

describe('isSafeClaimSlug', () => {
  it('accepts single host-safe labels', () => {
    for (const slug of ['ogabassey', 'future-merchant', 'Shop1', 'a']) {
      expect(isSafeClaimSlug(slug)).toBe(true);
    }
  });

  it('rejects empty, padded, dotted, and underscored slugs', () => {
    for (const slug of [
      '',
      ' ogabassey',
      'ogabassey ',
      'oga.bassey',
      'oga_bassey',
      '-ogabassey',
      'ogabassey-',
      'oga bassey',
    ]) {
      expect(isSafeClaimSlug(slug)).toBe(false);
    }
  });

  it('enforces the 63-octet DNS label limit', () => {
    expect(isSafeClaimSlug('a'.repeat(63))).toBe(true);
    // A 64-octet label cannot resolve: the sender schema fails closed
    // before dispatch and the URL builder throws instead of emailing an
    // unusable claim link.
    expect(isSafeClaimSlug('a'.repeat(64))).toBe(false);
  });
});
