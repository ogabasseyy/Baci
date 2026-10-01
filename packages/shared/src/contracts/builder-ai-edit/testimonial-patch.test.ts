import { describe, expect, it } from 'vitest';
import { testimonialPatchSchema } from './testimonial-patch';

describe('testimonialPatchSchema', () => {
  it('accepts a bounded testimonial update', () => {
    expect(
      testimonialPatchSchema.safeParse({
        componentType: 'Testimonial',
        quote: 'Loved it',
      }).success
    ).toBe(true);
  });
});
