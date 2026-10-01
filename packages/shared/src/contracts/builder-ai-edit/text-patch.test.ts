import { describe, expect, it } from 'vitest';
import { textPatchSchema } from './text-patch';

describe('textPatchSchema', () => {
  it('requires an editable text field', () => {
    expect(textPatchSchema.safeParse({ componentType: 'Text' }).success).toBe(
      false
    );
    expect(
      textPatchSchema.safeParse({ componentType: 'Text', title: 'About' })
        .success
    ).toBe(true);
  });
});
