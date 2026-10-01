import { describe, expect, it } from 'vitest';
import { getBranchesQueryKey } from './branch-query-key';

describe('getBranchesQueryKey', () => {
  it('separates merchant and inactive scopes', () => {
    expect(getBranchesQueryKey(undefined)).toEqual(['branches', null, false]);
    expect(getBranchesQueryKey('m', true)).toEqual(['branches', 'm', true]);
  });
});
