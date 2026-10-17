import { describe, expect, it } from 'vitest';
import {
  aliasFieldsMismatchMessage,
  matchingAliasFields,
} from './order-alias-fields';

describe('matchingAliasFields', () => {
  it('passes when either alias is absent and compares when both are present', () => {
    const check = matchingAliasFields('offerId', 'offer_id');

    expect(check({})).toBe(true);
    expect(check({ offerId: 'o1' })).toBe(true);
    expect(check({ offer_id: 'o1' })).toBe(true);
    expect(check({ offerId: 'o1', offer_id: 'o1' })).toBe(true);
    expect(check({ offerId: 'o1', offer_id: 'o2' })).toBe(false);
  });
});

describe('aliasFieldsMismatchMessage', () => {
  it('names both aliases', () => {
    expect(aliasFieldsMismatchMessage('offerId', 'offer_id')).toBe(
      'offerId and offer_id must match when both are provided'
    );
  });
});
