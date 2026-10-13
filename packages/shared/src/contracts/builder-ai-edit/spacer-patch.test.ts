import { describe, expect, it } from 'vitest';
import { spacerPatchSchema } from './spacer-patch';

describe('spacerPatchSchema', () => {
  it('accepts only the bounded spacing scale', () => {
    expect(
      spacerPatchSchema.safeParse({ componentType: 'Spacer', height: 'large' })
        .success
    ).toBe(true);
    expect(
      spacerPatchSchema.safeParse({ componentType: 'Spacer', height: 'huge' })
        .success
    ).toBe(false);
  });
});
