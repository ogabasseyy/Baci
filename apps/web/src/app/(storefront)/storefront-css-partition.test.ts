import { describe, expect, it } from 'vitest';
import { OGABASSEY_DARK_TOKENS } from '@/components/storefront/ogabassey/dark-mode-tokens';
import {
  readStorefrontDarkModeCss,
  readStorefrontFile,
} from './storefront-css-partition-read';

describe('storefront CSS partitioning', () => {
  it('keeps PDP-only selectors out of the shared storefront core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).not.toMatch(/data-ogabassey-pdp/);
    expect(coreCss).not.toMatch(/\.ogabassey-pdp-/);
  });

  it('keeps the broad PDP entrypoint focused on default product-detail utilities', () => {
    const pdpCss = readStorefrontFile('storefront-pdp.css');

    expect(pdpCss).not.toMatch(/storefront-core\.css/);
    expect(pdpCss).not.toMatch(/storefront-pdp-critical\.css/);
    expect(pdpCss).not.toMatch(/storefront-pdp-semantic\.css/);
    expect(pdpCss).not.toMatch(/storefront-pdp-tabs\.css/);
    expect(pdpCss).not.toMatch(/storefront-pdp-reviews\.css/);
    expect(pdpCss).toMatch(
      /@source\s+["'][^"']*products\/\[productSlug\]\/product-detail-client\.tsx/
    );
    expect(pdpCss).not.toMatch(
      /@source\s+["'][^"']*ogabassey\/pdp\/critical-shell\.tsx/
    );
    expect(pdpCss).not.toMatch(
      /@source\s+["'][^"']*product-details-page\/deferred-product-details-sections\.tsx/
    );
  });

  it('loads the OgaBassey dark-mode token layer from storefront core', () => {
    const coreCss = readStorefrontFile('storefront-core.css');
    const darkModeEntryCss = readStorefrontFile(
      'storefront-ogabassey-dark-mode.css'
    );

    expect(coreCss).toMatch(
      /@import\s+['"]\.\/storefront-ogabassey-dark-mode\.css['"];?/
    );
    expect(darkModeEntryCss).toMatch(
      /@import\s+['"]\.\/storefront-ogabassey-dark-mode-tokens\.css['"];?/
    );
    expect(darkModeEntryCss).toMatch(
      /@import\s+['"]\.\/storefront-ogabassey-dark-mode-utilities\.css['"];?/
    );
    expect(darkModeEntryCss).toMatch(
      /@import\s+['"]\.\/storefront-ogabassey-dark-mode-checkout-utilities\.css['"];?/
    );
  });

  it('keeps OgaBassey dark-mode utility styles split into auditable chunks', () => {
    const darkModeUtilityFiles = [
      'storefront-ogabassey-dark-mode-utilities.css',
      'storefront-ogabassey-dark-mode-checkout-utilities.css',
    ];

    for (const fileName of darkModeUtilityFiles) {
      expect(
        readStorefrontFile(fileName).split('\n').length
      ).toBeLessThanOrEqual(300);
    }
  });

  it('keeps the OgaBassey header and footer on the same chrome background tokens', () => {
    const coreCss = readStorefrontFile('storefront-core.css');
    const normalizedCoreCss = coreCss.replace(/\s+/g, ' ');

    expect(coreCss).toContain(
      '--ogabassey-chrome-background: var(--ogabassey-shell-background);'
    );
    expect(coreCss).toContain(
      '--ogabassey-chrome-text: var(--ogabassey-shell-text);'
    );
    expect(normalizedCoreCss).toMatch(
      /\.ogabassey-footer \{ background: var\(--ogabassey-chrome-background\); color: var\(--ogabassey-chrome-text\); \}/
    );
    expect(normalizedCoreCss).toMatch(
      /\.ogabassey-navbar__top \{ background: var\(--ogabassey-chrome-background\); color: var\(--ogabassey-chrome-text\);/
    );
    expect(normalizedCoreCss).not.toMatch(
      /\.ogabassey-footer \{ background: #1a1a1a;/
    );
  });

  it('keeps the CSS dark token literals aligned with the TS token contract', () => {
    const darkModeCss = readStorefrontDarkModeCss().toLowerCase();
    const expectedTokens = [
      ['--storefront-dark-background', OGABASSEY_DARK_TOKENS.background],
      ['--storefront-dark-foreground', OGABASSEY_DARK_TOKENS.foreground],
      ['--storefront-dark-card', OGABASSEY_DARK_TOKENS.card],
      [
        '--storefront-dark-card-foreground',
        OGABASSEY_DARK_TOKENS.cardForeground,
      ],
      ['--storefront-dark-muted', OGABASSEY_DARK_TOKENS.muted],
      [
        '--storefront-dark-muted-foreground',
        OGABASSEY_DARK_TOKENS.mutedForeground,
      ],
      ['--storefront-dark-border', OGABASSEY_DARK_TOKENS.border],
      ['--storefront-dark-primary', OGABASSEY_DARK_TOKENS.primary],
      [
        '--storefront-dark-primary-foreground',
        OGABASSEY_DARK_TOKENS.primaryForeground,
      ],
      ['--storefront-dark-secondary', OGABASSEY_DARK_TOKENS.secondary],
      [
        '--storefront-dark-secondary-foreground',
        OGABASSEY_DARK_TOKENS.secondaryForeground,
      ],
      ['--storefront-dark-accent', OGABASSEY_DARK_TOKENS.accent],
      [
        '--storefront-dark-accent-foreground',
        OGABASSEY_DARK_TOKENS.accentForeground,
      ],
      ['--storefront-dark-price', OGABASSEY_DARK_TOKENS.price],
      ['--storefront-dark-rating', OGABASSEY_DARK_TOKENS.rating],
      ['--storefront-dark-success', OGABASSEY_DARK_TOKENS.success],
      ['--storefront-dark-warning', OGABASSEY_DARK_TOKENS.warning],
      ['--storefront-dark-error', OGABASSEY_DARK_TOKENS.error],
    ] as const;

    for (const [cssVariable, token] of expectedTokens) {
      expect(darkModeCss).toContain(`${cssVariable}: ${token.toLowerCase()};`);
    }
  });

  it('keeps the OgaBassey dark-mode layer browser-safe and cosmetic-only', () => {
    const darkModeCss = readStorefrontDarkModeCss();
    const normalizedDarkModeCss = darkModeCss.replace(/\s+/g, ' ');

    expect(darkModeCss).toContain('@media (prefers-color-scheme: dark)');
    expect(darkModeCss).toContain('color-scheme: dark');
    expect(darkModeCss).toContain('caret-color: var(--store-accent');
    expect(normalizedDarkModeCss).not.toContain('storefront-mode-dark');
    expect(normalizedDarkModeCss).toContain(
      '.storefront-variant-ogabassey.storefront-mode-system, .storefront-variant-ogabassey.storefront-mode-system .ogabassey-storefront-shell'
    );
    expect(darkModeCss).toContain('--background: 0 0% 100% !important;');
    expect(darkModeCss).toContain('--foreground: 240 10% 3.9% !important;');
    expect(darkModeCss).toContain('--card: 0 0% 100% !important;');
    expect(darkModeCss).toContain('--primary: 239 45% 30% !important;');
    expect(darkModeCss).toContain('--background: 0 0% 4% !important;');
    expect(darkModeCss).toContain('--primary: 357 72% 48% !important;');
    expect(darkModeCss).toContain('--accent: 0 91% 71% !important;');
    expect(darkModeCss).toContain(
      '--store-primary: var(--storefront-dark-primary) !important;'
    );
    expect(darkModeCss).toContain(
      '--store-secondary: var(--storefront-dark-secondary) !important;'
    );
    expect(darkModeCss).toContain('background-color: #1a1a1a;');
    expect(darkModeCss).toContain('@supports (background-color: color-mix(');
    expect(darkModeCss).toContain('background-color: color-mix(');
    expect(normalizedDarkModeCss).toContain(
      '.storefront-variant-ogabassey.storefront-mode-system.storefront-ppr-static-shell'
    );
    expect(normalizedDarkModeCss).toContain('.storefront-shell-loading');
    expect(darkModeCss).toContain('.ogabassey-checkout-page');
    expect(normalizedDarkModeCss).toContain(
      '.storefront-variant-ogabassey.storefront-mode-system .ogabassey-storefront-shell .ogabassey-checkout-page'
    );
    expect(normalizedDarkModeCss).toContain('.text-green-900');
    expect(normalizedDarkModeCss).toContain('.text-emerald-900');
    expect(normalizedDarkModeCss).toContain('.text-red-900');
    expect(darkModeCss).toContain(
      'background-color: var(--storefront-dark-card);'
    );
    expect(normalizedDarkModeCss).toContain(
      ':is( .bg-white, .bg-gray-50, .bg-gray-100, .bg-gray-200'
    );
    expect(normalizedDarkModeCss).toContain('.bg-blue-100\\/50');
    expect(normalizedDarkModeCss).toContain('.hover\\:bg-blue-100\\/50:hover');
    expect(normalizedDarkModeCss).toContain('.bg-gray-200');
    expect(normalizedDarkModeCss).toContain('.hover\\:bg-gray-50:hover');
    expect(normalizedDarkModeCss).toContain('.hover\\:bg-gray-200:hover');
    expect(normalizedDarkModeCss).toContain('.border-blue-200');
    expect(normalizedDarkModeCss).toContain(':is(.text-blue-600');
    expect(normalizedDarkModeCss).toContain('.text-store-primary');
    expect(normalizedDarkModeCss).toContain('.text-primary');
    expect(normalizedDarkModeCss).toContain('.text-primary\\/60');
    expect(normalizedDarkModeCss).toContain('.fill-primary');
    expect(normalizedDarkModeCss).toContain('.text-amber-500');
    expect(normalizedDarkModeCss).toContain('.text-orange-500');
    expect(normalizedDarkModeCss).toContain('.fill-amber-500');
    expect(normalizedDarkModeCss).toContain('.bg-orange-500');
    expect(normalizedDarkModeCss).toContain('.text-red-600');
    expect(normalizedDarkModeCss).toContain('.text-green-600');
    expect(normalizedDarkModeCss).toContain(
      '.ogabassey-product-card-image-surface'
    );
    expect(darkModeCss).toContain('background-color: #f9fafb;');
    expect(darkModeCss).not.toContain('#92400e');
    expect(darkModeCss).not.toContain('#f59e0b');
    expect(darkModeCss).not.toContain('#fdba74');
    expect(darkModeCss).toContain('color: var(--storefront-dark-foreground);');
    expect(darkModeCss).not.toMatch(/cursor\s*:\s*url\(/);
    expect(darkModeCss).not.toMatch(/cursor\s*:\s*none/);
    expect(darkModeCss).not.toMatch(
      /filter\s*:\s*(invert|brightness|grayscale)/
    );
  });
});
