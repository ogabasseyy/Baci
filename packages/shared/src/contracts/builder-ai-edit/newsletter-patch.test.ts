import { describe, expect, it } from 'vitest';
import { newsletterPatchSchema } from './newsletter-patch';

describe('newsletterPatchSchema', () => {
  it('rejects an empty newsletter update', () => {
    expect(
      newsletterPatchSchema.safeParse({ componentType: 'Newsletter' }).success
    ).toBe(false);
  });
});
