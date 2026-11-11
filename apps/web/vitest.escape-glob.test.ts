import { describe, expect, it } from 'vitest';
import { escapeGlob } from './vitest.escape-glob';

describe('escapeGlob', () => {
  it.each([
    [
      'a Next.js route group',
      'src/app/(storefront)',
      'src/app/\\(storefront\\)',
    ],
    [
      'a dynamic segment',
      'orders/[orderId]/x.test.ts',
      'orders/\\[orderId\\]/x.test.ts',
    ],
    ['braces', 'a{b,c}', 'a\\{b,c\\}'],
    ['wildcards and operators', 'a*b?c!d+e@f', 'a\\*b\\?c\\!d\\+e\\@f'],
    ['a backslash', 'back\\slash', 'back\\\\slash'],
  ])('escapes %s', (_label, input, expected) => {
    expect(escapeGlob(input)).toBe(expected);
  });

  it.each([
    'src/lib',
    'tools/connector-gateway/server.test.ts',
    'src/app/.well-known',
    'src/app/openapi.json',
    '',
  ])('leaves the plain path "%s" unchanged', (path) => {
    expect(escapeGlob(path)).toBe(path);
  });

  it('escapes every occurrence, not only the first', () => {
    expect(escapeGlob('((a))')).toBe('\\(\\(a\\)\\)');
  });
});
