// @vitest-environment node
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { expect, it } from 'vitest';

it('keeps request-bound account metadata in a small server boundary alongside the client view', () => {
  const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  expect(source).not.toContain("'use client'");
  expect(source).toContain('<CustomerOrderDetailsClient />');
  expect(source).toMatch(
    /<Suspense fallback=\{null\}>\s*<OrderDetailsRequestMarker\s*\/>\s*<\/Suspense>/
  );
});
