import { describe, expect, it } from 'vitest';
import { ExpenseBranchLabelSchema } from './expense-branch-label';

describe('ExpenseBranchLabelSchema', () => {
  it('parses the explicitly selected historical branch fields', () => {
    expect(
      ExpenseBranchLabelSchema.parse({ id: 'branch-1', name: 'Lagos main' })
    ).toEqual({ id: 'branch-1', name: 'Lagos main' });
  });

  it('rejects a branch record without a display name', () => {
    expect(() => ExpenseBranchLabelSchema.parse({ id: 'branch-1' })).toThrow();
  });

  it('rejects undeclared branch projection fields', () => {
    expect(() =>
      ExpenseBranchLabelSchema.parse({
        id: 'branch-1',
        name: 'Lagos main',
        slug: 'lagos-main',
      })
    ).toThrow();
  });
});
