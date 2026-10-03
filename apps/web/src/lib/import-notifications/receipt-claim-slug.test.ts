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
});
