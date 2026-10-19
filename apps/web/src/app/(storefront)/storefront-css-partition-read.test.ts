import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

const storefrontDir = dirname(fileURLToPath(import.meta.url));

describe('readStorefrontFile', () => {
  it('throws a clear error when a CSS fixture is missing', () => {
    expect(() => readStorefrontFile('nonexistent.css')).toThrow(
      `Missing storefront fixture nonexistent.css in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  });
});
