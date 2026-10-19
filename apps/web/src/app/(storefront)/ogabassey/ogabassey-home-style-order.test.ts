// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('homepage server stylesheet ownership', () => {
  it('keeps external stylesheets off the server shell and defers them to the client loader', () => {
    const shellSource = readFileSync(
      new URL('./ogabassey-home-critical-shell.tsx', import.meta.url),
      'utf8'
    );
    const loaderSource = readFileSync(
      new URL('./load-ogabassey-home-styles.ts', import.meta.url),
      'utf8'
    );
    expect(shellSource).not.toContain("'use client'");
    for (const stylesheet of ['storefront-core.css', 'storefront-home.css']) {
      expect(shellSource).not.toContain(stylesheet);
      expect(loaderSource).toContain(
        `import('@/app/(storefront)/${stylesheet}')`
      );
    }
  });
});
