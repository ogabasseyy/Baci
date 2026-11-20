import { describe, expect, it } from 'vitest';
import { getActiveCustomDomain } from './get-active-custom-domain';

describe('getActiveCustomDomain', () => {
  it('returns a domain outside the Baci root', () => {
    expect(getActiveCustomDomain('ogabassey.com', 'usebaci.com')).toBe(
      'ogabassey.com'
    );
  });

  it('trims surrounding whitespace from the domain', () => {
    expect(getActiveCustomDomain('  shop.example.com ', 'usebaci.com')).toBe(
      'shop.example.com'
    );
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['   '],
  ])('returns null for an empty primary domain (%j)', (value) => {
    expect(getActiveCustomDomain(value, 'usebaci.com')).toBeNull();
  });

  describe('bugfix: generated Baci address mistaken for a custom domain', () => {
    it('returns null for a Baci subdomain', () => {
      expect(getActiveCustomDomain('oldstore.usebaci.com', 'usebaci.com')).toBe(
        null
      );
    });

    it('matches the Baci root case-insensitively', () => {
      expect(getActiveCustomDomain('OldStore.UseBaci.com', 'usebaci.com')).toBe(
        null
      );
      expect(getActiveCustomDomain('oldstore.usebaci.com', 'UseBaci.com')).toBe(
        null
      );
    });

    it('returns null for the Baci root itself', () => {
      expect(getActiveCustomDomain('usebaci.com', 'usebaci.com')).toBeNull();
    });

    it('keeps domains that merely contain or end with the root text', () => {
      expect(getActiveCustomDomain('notusebaci.com', 'usebaci.com')).toBe(
        'notusebaci.com'
      );
      expect(
        getActiveCustomDomain('usebaci.com.shop.example', 'usebaci.com')
      ).toBe('usebaci.com.shop.example');
    });
  });
});
