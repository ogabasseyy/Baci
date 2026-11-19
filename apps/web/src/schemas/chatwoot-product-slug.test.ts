import { describe, expect, it } from 'vitest';
import { chatwootProductSlugSchema } from './chatwoot-product-slug';

describe('bugfix: Chatwoot slug schema matches the catalog slug domain', () => {
  const ok = (value: string) =>
    chatwootProductSlugSchema.safeParse(value).success;

  it('accepts 200-character slugs and dotted slugs the catalog allows', () => {
    expect(ok('a'.repeat(200))).toBe(true);
    expect(ok('galaxy-s24.ultra')).toBe(true);
  });

  it('rejects overlong, traversal and malformed slugs', () => {
    for (const slug of [
      '',
      'a'.repeat(201),
      '../x',
      'a..b',
      'a/b',
      '-a',
      'a--b',
    ]) {
      expect(ok(slug)).toBe(false);
    }
  });
});
