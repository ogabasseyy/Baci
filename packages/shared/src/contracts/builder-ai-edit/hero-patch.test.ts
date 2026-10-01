import { describe, expect, it } from 'vitest';
import { heroPatchSchema } from './hero-patch';

describe('heroPatchSchema', () => {
  it('requires a bounded editable field', () => {
    expect(heroPatchSchema.safeParse({ componentType: 'Hero' }).success).toBe(
      false
    );
    expect(
      heroPatchSchema.safeParse({ componentType: 'Hero', title: 'Welcome' })
        .success
    ).toBe(true);
  });
});
