import { describe, expect, it } from 'vitest';
import { PROTECTED_OFFER_STATEMENTS } from './protected-offer-statements';

describe('protected offer restricted statements', () => {
  it('exposes only publication and historical read with seven scoped parameters', () => {
    expect(Object.keys(PROTECTED_OFFER_STATEMENTS)).toEqual([
      'publishProtectedOffer',
      'readProtectedOffer',
    ]);
    for (const statement of Object.values(PROTECTED_OFFER_STATEMENTS)) {
      expect(statement.parameters).toBe(7);
      expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
      expect(statement.text).toMatch(
        /^SELECT piggyvest_protected_offer\.(publish|read)\(\$1::uuid,\$2::uuid,\$3::uuid,\$4::uuid,\$5::text,\$6::uuid,\$7::uuid\) AS result$/
      );
    }
  });
});
