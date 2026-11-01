import { expect, it } from 'vitest';
import { extractDependencyUrls } from './ogabassey-layout-dependencies';

it('deduplicates same-origin static assets and rejects cross-origin ones', () => {
  const base = 'http://localhost:3000/store';
  expect(
    extractDependencyUrls(
      '<script src="/_next/static/a.js"></script><script src="/_next/static/a.js"></script>',
      base
    )
  ).toEqual(['/_next/static/a.js']);
  expect(() =>
    extractDependencyUrls(
      '<script src="https://evil.example/_next/static/a.js"></script>',
      base
    )
  ).toThrow(/cross-origin/i);
});
