import { describe, expect, it } from 'vitest';
import { componentPatchSchema } from './component-patch';

describe('componentPatchSchema', () => {
  it('selects a focused component patch schema by componentType', () => {
    expect(
      componentPatchSchema.safeParse({ componentType: 'Text', title: 'About' })
        .success
    ).toBe(true);
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Unknown',
        title: 'Nope',
      }).success
    ).toBe(false);
  });
});
