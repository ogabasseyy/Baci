import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_DARK_TOKENS } from '@/components/storefront/ogabassey/dark-mode-tokens';

const storefrontDir = dirname(fileURLToPath(import.meta.url));

function readStorefrontFile(fileName: string): string {
  const filePath = join(storefrontDir, fileName);

  if (!existsSync(filePath)) {
    throw new Error(
      `Missing storefront fixture ${fileName} in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  }

  return readFileSync(filePath, 'utf8');
}

function readStorefrontDarkModeCss(): string {
  return [
    readStorefrontFile('storefront-ogabassey-dark-mode.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-tokens.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-utilities.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-checkout-utilities.css'),
  ].join('\n');
}

describe('storefront CSS partitioning', () => {
  it('throws a clear error when a CSS fixture is missing', () => {
    expect(() => readStorefrontFile('nonexistent.css')).toThrow(
      `Missing storefront fixture nonexistent.css in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  });

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

  it('covers darkened OgaBassey tinted panels without changing light category links', () => {
    const coreCss = readStorefrontFile('storefront-core.css');
    const utilityCss = readStorefrontFile(
      'storefront-ogabassey-dark-mode-utilities.css'
    );
    const checkoutUtilityCss = readStorefrontFile(
      'storefront-ogabassey-dark-mode-checkout-utilities.css'
    );
    const combinedUtilityCss = [utilityCss, checkoutUtilityCss].join('\n');
    const darkPanelBackgroundUtilities = [
      '.bg-emerald-50',
      '.bg-emerald-100',
      '.bg-white\\/50',
      '.bg-white\\/95',
      '.bg-gray-50\\/95',
      '.bg-red-50\\/50',
      '.bg-red-50\\/80',
    ];
    const darkPanelTextUtilities = [
      '.text-blue-900',
      '.text-indigo-700',
      '.text-yellow-700',
    ];
    const darkPrimaryForegroundUtilities = [
      '.text-store-primary',
      '.text-store-primary\\/60',
      '.text-store-primary\\/80',
      '.text-store-primary\\/90',
      '.hover\\:text-store-primary:hover',
      '.hover\\:text-store-primary\\/80:hover',
      '.text-primary',
      '.text-primary\\/60',
      '.text-primary\\/80',
      '.text-primary\\/90',
      '.hover\\:text-primary:hover',
      '.hover\\:text-primary\\/80:hover',
      '.focus\\:text-primary:focus',
      '.group:hover .group-hover\\:text-primary',
    ];
    const darkSuccessTextUtilities = [
      '.text-green-600',
      '.text-green-900',
      '.text-emerald-700',
      '.text-emerald-900',
    ];
    const darkErrorTextUtilities = ['.text-red-600', '.text-red-900'];
    const darkPanelBorderUtilities = [
      '.border-emerald-100',
      '.border-emerald-200',
    ];
    const darkPrimaryFillUtilities = [
      '.fill-primary',
      '.hover\\:fill-primary:hover',
      '.focus\\:fill-primary:focus',
      '.group:hover .group-hover\\:fill-primary',
    ];
    const scopedPanelClasses = [
      'ogabassey-storefront-shell',
      'ogabassey-checkout-page',
    ];
    const categoryHubLightLink =
      /\.ogabassey-category-hub-card__link\s*\{[\s\S]*?color:\s*var\(--store-primary,\s*#d62027\);/;
    const categoryHubLightEyebrow =
      /\.ogabassey-category-hub-card-grid__eyebrow\s*\{[\s\S]*?color:\s*var\(--store-primary,\s*#d62027\);/;
    const categoryHubDarkAccent =
      /@media \(prefers-color-scheme: dark\)[\s\S]*\.storefront-variant-ogabassey\.storefront-mode-system[\s\S]*\.ogabassey-category-hub-card__link[\s\S]*color:\s*var\(--storefront-dark-accent,\s*var\(--store-primary,\s*#d62027\)\);/;
    const categoryHubDarkEyebrow =
      /@media \(prefers-color-scheme: dark\)[\s\S]*\.storefront-variant-ogabassey\.storefront-mode-system[\s\S]*\.ogabassey-category-hub-card-grid__eyebrow[\s\S]*color:\s*var\(--storefront-dark-accent,\s*var\(--store-primary,\s*#d62027\)\);/;
    const emptyCartDarkAccent =
      /@media \(prefers-color-scheme: dark\)[\s\S]*\.storefront-variant-ogabassey\.storefront-mode-system[\s\S]*\.ogabassey-cart-empty-state__eyebrow[\s\S]*\.ogabassey-cart-empty-state__secondary-action:hover[\s\S]*color:\s*var\(--storefront-dark-accent,\s*var\(--store-primary,\s*#d62027\)\);/;
    const checkoutRootBackground =
      /\.storefront-variant-ogabassey\.storefront-mode-system\s+\.ogabassey-storefront-shell\s+\.ogabassey-checkout-page\.bg-gray-50\\\/50\s*\{\s*background-color:\s*var\(--storefront-dark-background\);/;
    const imageSurfaceBackground =
      /\.ogabassey-product-card-image-surface\.bg-gray-50[\s\S]*background-color:\s*#f9fafb;/;
    const scopedUtilityRule = (
      scopeClass: string,
      utility: string,
      declarationPattern: string
    ) =>
      new RegExp(
        `\\.storefront-variant-ogabassey\\.storefront-mode-system\\s+\\.${scopeClass}\\s+:is\\([\\s\\S]*${utility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*\\)\\s*\\{\\s*${declarationPattern}`
      );

    for (const scopeClass of scopedPanelClasses) {
      for (const utility of darkPanelBackgroundUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'background-color:\\s*var\\(--storefront-dark-card\\);'
          )
        );
      }

      for (const utility of darkPanelTextUtilities) {
        const color = utility.includes('blue')
          ? '#93c5fd'
          : utility.includes('indigo')
            ? '#a5b4fc'
            : '#fde68a';

        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(scopeClass, utility, `color:\\s*${color};`)
        );
      }

      for (const utility of darkPrimaryForegroundUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'color:\\s*var\\(--storefront-dark-accent\\);'
          )
        );
      }

      for (const utility of darkSuccessTextUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'color:\\s*var\\(--storefront-dark-success\\);'
          )
        );
      }

      for (const utility of darkErrorTextUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'color:\\s*var\\(--storefront-dark-error\\);'
          )
        );
      }

      for (const utility of darkPanelBorderUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'border-color:\\s*var\\(--storefront-dark-border\\);'
          )
        );
      }

      for (const utility of darkPrimaryFillUtilities) {
        expect(combinedUtilityCss).toMatch(
          scopedUtilityRule(
            scopeClass,
            utility,
            'fill:\\s*var\\(--storefront-dark-accent\\);'
          )
        );
      }
    }

    expect(coreCss).toMatch(categoryHubLightLink);
    expect(coreCss).toMatch(categoryHubLightEyebrow);
    expect(coreCss).toMatch(categoryHubDarkAccent);
    expect(coreCss).toMatch(categoryHubDarkEyebrow);
    expect(coreCss).toMatch(emptyCartDarkAccent);
    expect(combinedUtilityCss).toMatch(checkoutRootBackground);
    expect(combinedUtilityCss).toMatch(imageSurfaceBackground);
  });

  it('marks cart and checkout thumbnails as neutral image surfaces', () => {
    const imageSurfaceSourceFiles = [
      '../../components/storefront/ogabassey/pages/cart.tsx',
      '../../components/storefront/ogabassey/components/CartSidebar.tsx',
      '../../components/storefront/ogabassey/pages/checkout-page.tsx',
      '../../components/storefront/ogabassey/components/MobileOrderSummary.tsx',
      '../../components/storefront/ogabassey/pages/receipts.tsx',
      '../../components/storefront/ogabassey/pages/order-details-item-row.tsx',
      '../../components/storefront/ogabassey/pages/saved.tsx',
      '../../components/storefront/ogabassey/pages/saved-page.tsx',
      '../../components/storefront/ogabassey/pages/orders.tsx',
      '../../components/storefront/ogabassey/components/ProductListItem.tsx',
      '../../components/storefront/ogabassey/pages/product-details.tsx',
      '../../components/storefront/ogabassey/pages/reviews.tsx',
      '../../components/storefront/ogabassey/pages/cart-page-line-item.tsx',
      '../../components/storefront/ogabassey/components/UpsellToast.tsx',
    ];

    for (const fileName of imageSurfaceSourceFiles) {
      expect(readStorefrontFile(fileName)).toContain(
        'ogabassey-product-card-image-surface'
      );
    }
  });

  it('loads OgaBassey below-fold PDP styles through the deferred PDP stylesheet', () => {
    const deferredPdpCss = readStorefrontFile(
      'storefront-ogabassey-pdp-deferred.css'
    );

    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-semantic\.css['"];?/
    );
    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-tabs\.css['"];?/
    );
    expect(deferredPdpCss).toMatch(
      /@import\s+['"]\.\/storefront-pdp-reviews\.css['"];?/
    );
  });

  it('validates OgaBassey category PDP route imports critical CSS in page, PDP CSS in renderer, and excludes PDP CSS from client', () => {
    const categoryPdpPage = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/page.tsx'
    );
    const defaultRenderer = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/default-product-page-renderer.tsx'
    );
    const defaultDetailClient = readStorefrontFile(
      '[slug]/(catalog)/(pdp)/[category]/[productSlug]/default-product-detail-client.tsx'
    );

    expect(categoryPdpPage).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp-critical\.css['"];?/
    );
    expect(defaultRenderer).toMatch(
      /import\s+['"]@\/app\/\(storefront\)\/storefront-pdp\.css['"];?/
    );
    expect(defaultDetailClient).not.toMatch(/storefront-pdp\.css/);
  });

  it('keeps the publication fallback, gated Hero and empty-feed geometry in critical CSS', () => {
    const homeCriticalCss = readStorefrontFile('storefront-home-critical.css');

    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*ogabassey-static-home-page-content\.tsx["']/
    );
    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*ogabassey-publication-safe-hero-fallback\.tsx["']/
    );
    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*components\/Hero\.tsx["']/
    );
    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*hero-mobile-carousel\.tsx["']/
    );
    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*hero-desktop-grid\.tsx["']/
    );
    expect(homeCriticalCss).toMatch(
      /@source\s+["'][^"']*ogabassey-empty-mobile-hero\.tsx["']/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*ogabassey-home-hero-fallback\.tsx["']/
    );
  });

  it('registers store color tokens in the render-blocking critical CSS so the hero paints styled on first frame', () => {
    // Regression guard: the store-* colors are only registered via the shared
    // @theme inline token block. If the home critical CSS does not import it, the
    // critical layer cannot generate `.bg-store-secondary` et al. and the hero
    // first-paints unstyled (dark shell shows through) until the deferred CSS.
    const homeCriticalCss = readStorefrontFile('storefront-home-critical.css');
    expect(homeCriticalCss).toMatch(
      /@import\s+["']\.\/storefront-theme-tokens\.css["']/
    );

    const tokens = readStorefrontFile('storefront-theme-tokens.css');
    // Tokens must use @theme inline + literal hex fallbacks so utilities emit a
    // paintable color even before the per-merchant --store-* vars resolve.
    expect(tokens).toMatch(/@theme inline/);
    expect(tokens).toMatch(
      /--color-store-secondary:\s*var\(--store-secondary,\s*#f3f4f6\)/
    );
  });

  it('keeps homepage product-card utilities deferred while retaining critical grid geometry selectors', () => {
    const homeCriticalCss = readStorefrontFile('storefront-home-critical.css');
    const homeCss = readStorefrontFile('storefront-home.css');

    expect(homeCriticalCss).not.toMatch(/storefront-foundation\.css/);
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*HomeProductGrid\.tsx/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*HomeProductGridCard\.tsx/
    );
    expect(homeCriticalCss).not.toMatch(
      /@source\s+["'][^"']*ProductRatingRow\.tsx/
    );
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products__grid\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-products__empty\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-product-card\b/);
    expect(homeCriticalCss).toMatch(/\.ogabassey-home-product-card__media\b/);
    expect(homeCriticalCss).toMatch(
      /\.ogabassey-home-product-card__condition--open-box\b/
    );
    expect(homeCriticalCss).not.toMatch(/animation:\s*pulse/);
    expect(homeCriticalCss).not.toMatch(/@keyframes\s+pulse/);

    expect(homeCss).toMatch(/@source\s+["'][^"']*HomeProductGrid\.tsx/);
    expect(homeCss).toMatch(/@source\s+["'][^"']*HomeProductGridCard\.tsx/);
    expect(homeCss).toMatch(/@source\s+["'][^"']*ProductRatingRow\.tsx/);
  });

  it('keeps deferred assistant launcher selectors out of the PPR shell critical stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.storefront-shell-loading/);
    expect(coreCss).toMatch(/\.storefront-ppr-static-shell/);
    expect(coreCss).toMatch(/\.ogabassey-navbar/);
    expect(coreCss).toMatch(/\.ogabassey-mobile-footer/);
    expect(coreCss).not.toMatch(/\.ogabassey-chat-/);
  });

  it('keeps category hub discovery card styles in the shared storefront core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-category-hub-card(?!-)\b/);
    expect(coreCss).toMatch(/\.ogabassey-category-hub-card-grid\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-category-hub-card-grid\s*\{[^}]*display:\s*grid/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-category-hub-card__description\s*\{[^}]*font-size:\s*0\.9375rem/s
    );
  });

  it('keeps the cart empty-state styles in the shared storefront core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-cart-empty-state\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-cart-empty-state\s*\{[^}]*var\(--ogabassey-surface\)/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-cart-empty-state__primary-action\s*\{[^}]*var\(--ogabassey-brand\)/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-cart-empty-state\s*\{[^}]*background:\s*#fff/s
    );
  });

  it('keeps OgaBassey footer contrast styles in the shared core stylesheet', () => {
    const coreCss = readStorefrontFile('storefront-core.css');

    expect(coreCss).toMatch(/\.ogabassey-footer\b/);
    expect(coreCss).toMatch(
      /\.ogabassey-footer\s*\{[^}]*background:\s*var\(--ogabassey-chrome-background\)/s
    );
    expect(coreCss).toMatch(
      /\.ogabassey-footer\s*\{[^}]*color:\s*var\(--ogabassey-chrome-text\)/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*background:\s*#1a1a1a/s
    );
    expect(coreCss).not.toMatch(/\.ogabassey-footer\s*\{[^}]*border-top:/s);
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*var\(--store-background-text/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer\s*\{[^}]*var\(--store-background,/s
    );
    expect(coreCss).not.toMatch(
      /\.ogabassey-footer__pattern\s*\{[^}]*radial-gradient/s
    );
  });

  it('loads deferred assistant launcher styles through the assistant chunk stylesheet', () => {
    const chatCss = readStorefrontFile('storefront-chat.css');

    expect(chatCss).toMatch(/\.ogabassey-chat-anchor/);
    expect(chatCss).toMatch(/\.ogabassey-chat-button/);
    expect(chatCss).toMatch(/\.ogabassey-chat-badge/);
  });
});
