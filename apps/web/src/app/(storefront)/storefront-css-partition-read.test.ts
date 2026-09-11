import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  readStorefrontCoreCss,
  readStorefrontFile,
} from './storefront-css-partition-read';

const storefrontDir = dirname(fileURLToPath(import.meta.url));

describe('readStorefrontFile', () => {
  it('throws a clear error when a CSS fixture is missing', () => {
    expect(() => readStorefrontFile('nonexistent.css')).toThrow(
      `Missing storefront fixture nonexistent.css in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  });
});

describe('readStorefrontCoreCss', () => {
  it('inlines focused storefront-core sheets so selector contracts stay on the entry graph', () => {
    const coreCss = readStorefrontCoreCss();

    expect(coreCss).toMatch(/\.ogabassey-storefront-shell\b/);
    expect(coreCss).toMatch(/\.ogabassey-navbar__top\b/);
    expect(coreCss).toMatch(/\.storefront-ppr-static-shell\b/);
    expect(coreCss).toMatch(
      /@import\s+['"]\.\/storefront-ogabassey-dark-mode\.css['"];?/
    );
  });
});
