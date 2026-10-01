import { describe, expect, it } from 'vitest';
import { getBuilderComponentId } from './get-builder-component-id';

describe('getBuilderComponentId', () => {
  it('returns undefined instead of throwing for legacy blocks without props', () => {
    expect(getBuilderComponentId({ type: 'Legacy' })).toBeUndefined();
    expect(
      getBuilderComponentId({ props: null, type: 'Legacy' })
    ).toBeUndefined();
  });
});
