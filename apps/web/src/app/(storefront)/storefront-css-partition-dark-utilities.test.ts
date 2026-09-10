import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

describe('storefront CSS partitioning (dark utilities)', () => {
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
      '../../components/storefront/ogabassey/components/MobileCheckoutComponents.tsx',
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
});
