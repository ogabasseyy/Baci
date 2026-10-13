import { describe, expect, it } from 'vitest';
import { jumiaCredentialPaths } from './jumia-credential-paths';

describe('Jumia credential paths', () => {
  it('covers every known Jumia credential route through env', () => {
    expect(jumiaCredentialPaths).toHaveLength(13);
    expect(
      jumiaCredentialPaths.every(
        (path) =>
          path[0]?.includes('/marketplace/jumia/') &&
          path.at(-1) === 'apps/web/src/env.ts'
      )
    ).toBe(true);
  });
});
