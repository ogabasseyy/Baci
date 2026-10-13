import { describe, expect, it } from 'vitest';
import { buttonPatchSchema } from './button-patch';

describe('buttonPatchSchema', () => {
  it('accepts a bounded storefront button and rejects an unsafe link', () => {
    expect(
      buttonPatchSchema.safeParse({
        componentType: 'Button',
        link: '/products',
        text: 'Shop now',
      }).success
    ).toBe(true);
    expect(
      buttonPatchSchema.safeParse({
        componentType: 'Button',
        link: 'javascript:alert(1)',
      }).success
    ).toBe(false);
  });
});
