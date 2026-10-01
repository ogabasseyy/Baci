import { describe, expect, it } from 'vitest';
import { findCleanIdentifierEnd } from './find-clean-identifier-end';

describe('findCleanIdentifierEnd', () => {
  it('skips internal display metadata between model tokens', () => {
    expect(
      findCleanIdentifierEnd(
        ['apple', 'air', '13', 'inch', 'm4'],
        ['air', 'm4'],
        1
      )
    ).toBe(5);
  });

  it('rejects unrelated words between model tokens', () => {
    expect(
      findCleanIdentifierEnd(['air', 'portable', 'm4'], ['air', 'm4'], 0)
    ).toBeNull();
  });
});
