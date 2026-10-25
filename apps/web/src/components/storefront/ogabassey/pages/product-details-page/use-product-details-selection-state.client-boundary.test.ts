import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('product details client boundary', () => {
  it('declares the client boundary before imports', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/components/storefront/ogabassey/pages/product-details-page/use-product-details-selection-state.ts'
      ),
      'utf8'
    );
    expect(source.trimStart().startsWith("'use client';")).toBe(true);
  });
});
