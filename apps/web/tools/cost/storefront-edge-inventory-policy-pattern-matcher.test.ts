import { describe, expect, it } from 'vitest';

function matchesRoutePattern(routePattern: string, pathname: string) {
  const patternSegments = routePattern.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  if (patternSegments.some((segment) => segment.startsWith('{*')))
    throw new Error(
      `catch-all route patterns are unsupported: ${routePattern}`
    );
  return (
    patternSegments.length === pathSegments.length &&
    patternSegments.every(
      (segment, index) =>
        (segment.startsWith('{') && segment.endsWith('}')) ||
        segment === pathSegments[index]
    )
  );
}

describe('storefront edge query-decision test matcher', () => {
  it('rejects catch-all patterns', () => {
    expect(() => matchesRoutePattern('/blog/{*path}', '/blog/example')).toThrow(
      'catch-all route patterns are unsupported: /blog/{*path}'
    );
  });
});
