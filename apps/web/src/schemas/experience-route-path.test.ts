import { describe, expect, it } from 'vitest';
import { experienceCanonicalRoutePathSchema } from './experience-route-path';

describe('canonical experience route paths', () => {
  it('accepts root, nested paths, and the maximum supported length', () => {
    expect(experienceCanonicalRoutePathSchema.parse('/')).toBe('/');
    expect(experienceCanonicalRoutePathSchema.parse('/products/a%20b')).toBe(
      '/products/a%20b'
    );
    expect(
      experienceCanonicalRoutePathSchema.safeParse(`/${'x'.repeat(239)}`)
        .success
    ).toBe(true);
  });

  it.each([
    '',
    'products/item',
    '//other.example/path',
    `/${'x'.repeat(240)}`,
  ])('rejects noncanonical route path %s', (path) => {
    expect(experienceCanonicalRoutePathSchema.safeParse(path).success).toBe(
      false
    );
  });
});
