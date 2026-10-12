import { describe, expect, it } from 'vitest';
import { REQUIRED_UNTRACKED_PREFIXES } from './customer-savings-snapshot-required-prefixes';

describe('REQUIRED_UNTRACKED_PREFIXES', () => {
  it('covers the savings API, schemas, and staging tooling', () => {
    for (const prefix of [
      'apps/web/src/app/api/storefront/customer/savings/funding/',
      'apps/web/src/schemas/cancel-plan',
      'apps/web/src/lib/piggyvest/',
      'apps/web/tools/piggyvest-staging/customer-draft-proxy-routes',
      'packages/shared/src/contracts/piggyvest-',
    ]) {
      expect(REQUIRED_UNTRACKED_PREFIXES).toContain(prefix);
    }
  });

  it('lists unique prefixes', () => {
    expect(new Set(REQUIRED_UNTRACKED_PREFIXES).size).toBe(
      REQUIRED_UNTRACKED_PREFIXES.length
    );
  });
});
