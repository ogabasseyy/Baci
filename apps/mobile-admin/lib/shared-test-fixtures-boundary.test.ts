import { join } from 'node:path';
import { findFixtureImportOffenders } from '../../../.github/scripts/shared-test-fixtures-boundary';

// Import boundary (thin wrapper over the single shared
// implementation in .github/scripts/shared-test-fixtures-boundary.ts):
// production (non-test) sources in this app — and in
// packages/shared/src — must never import shared test fixtures.
// This suite runs in this app's own CI, so a mobile-only PR cannot
// slip a fixture import past the web-only guard.
// __dirname is provided by both Jest (CJS) and Vitest (node env);
// import.meta cannot be used here because Jest parses this file as CJS.
const appRoot = join(__dirname, '..');
const sharedSrc = join(appRoot, '..', '..', 'packages', 'shared', 'src');

describe('shared test-fixtures import boundary', () => {
  it('no non-test source imports @baci/shared/test-fixtures', () => {
    expect(findFixtureImportOffenders([appRoot, sharedSrc])).toEqual([]);
  }, 60_000);
});
