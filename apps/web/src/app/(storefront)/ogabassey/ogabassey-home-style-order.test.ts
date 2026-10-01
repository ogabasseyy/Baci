// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('homepage server stylesheet ownership', () => {
  it('includes content styles in the server shell before hydration', () => {
    const source = readFileSync(
      new URL('./ogabassey-home-critical-shell.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain("'use client'");
    for (const stylesheet of ['storefront-core.css', 'storefront-home.css']) {
      expect(source).toContain(`import '@/app/(storefront)/${stylesheet}';`);
    }
  });
});
