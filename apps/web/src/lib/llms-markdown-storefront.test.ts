import { describe, expect, it } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  buildCategoryMarkdown,
  buildProductMarkdown,
  buildStorefrontAboutMarkdown,
  buildStorefrontContactMarkdown,
  buildStorefrontFaqMarkdown,
  buildStorefrontHomeMarkdown,
} from '@/lib/llms-markdown-storefront';

const merchant: CachedMerchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  site_title: 'Ogabassey',
  site_tagline: 'Easybuy Gadgets',
  site_description: 'Shop phones, accessories, and gadgets.',
  business_type: 'electronics',
  logo_url: '',
  phone: '+2348000000000',
  email: 'hello@ogabassey.com',
  slug: 'ogabassey',
  business_address: 'Lagos, Nigeria',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'tpl-1',
  plan_tier: 'pro',
  premium_features: null,
  faq_items: [
    { question: 'Do you offer delivery?', answer: 'Yes, nationwide.' },
  ],
};

describe('llms markdown storefront builders', () => {
  it('builds the storefront home mirror', () => {
    const home = buildStorefrontHomeMarkdown(merchant, 'https://ogabassey.com');

    expect(home).toContain('https://ogabassey.com/sitemap.xml');
    expect(home).toContain('https://ogabassey.com/{category}/{productSlug}');
    expect(home).toContain(
      '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons'
    );
    expect(home).toContain(
      '- `/{category}/brands/{brandSlug}/families/{familySlug}`: Model family authority hub for a specific product generation'
    );
    expect(home).toContain(
      '- `/{category}/compare/{comparisonSlug}`: Side-by-side product or brand comparison page with structured specs'
    );
    expect(home).toContain(
      '- `/{category}/best-under/{priceBandSlug}`: Budget-segmented buying guide and product rankings'
    );
  });

  it('normalizes trailing slashes in storefront home routes', () => {
    const home = buildStorefrontHomeMarkdown(
      merchant,
      'https://ogabassey.com/'
    );

    expect(home).toContain('https://ogabassey.com/sitemap.xml');
    expect(home).toContain('https://ogabassey.com/{category}/{productSlug}');
    expect(home).toContain(
      '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons'
    );
    expect(home).toContain(
      '- `/{category}/brands/{brandSlug}/families/{familySlug}`: Model family authority hub for a specific product generation'
    );
    expect(home).toContain(
      '- `/{category}/compare/{comparisonSlug}`: Side-by-side product or brand comparison page with structured specs'
    );
    expect(home).toContain(
      '- `/{category}/best-under/{priceBandSlug}`: Budget-segmented buying guide and product rankings'
    );
    expect(home).not.toContain('https://ogabassey.com//');
  });

  it('normalizes trailing slashes across storefront markdown builders', () => {
    const origin = 'https://ogabassey.com/';
    const product = {
      id: 'p6',
      name: 'USB Cable',
      slug: 'usb-cable',
      description: 'Braided cable.',
      price: 6000,
      category: 'Accessories',
      stock: 2,
      stock_quantity: 2,
      manage_stock: true,
      images: [],
    };

    const [
      aboutMarkdown,
      contactMarkdown,
      faqMarkdown,
      categoryMarkdown,
      productMarkdown,
    ] = [
      buildStorefrontAboutMarkdown(merchant, origin),
      buildStorefrontContactMarkdown(merchant, origin),
      buildStorefrontFaqMarkdown(merchant, origin),
      buildCategoryMarkdown(merchant, origin, 'accessories', {
        isCollection: true,
        name: 'Accessories',
        products: [product],
      }),
      buildProductMarkdown(merchant, origin, product),
    ];

    for (const result of [
      aboutMarkdown,
      contactMarkdown,
      faqMarkdown,
      categoryMarkdown,
      productMarkdown,
    ]) {
      expect(result).not.toContain('https://ogabassey.com//');
    }

    expect(aboutMarkdown).toContain('Canonical host: https://ogabassey.com');
    expect(contactMarkdown).toContain('Canonical host: https://ogabassey.com');
    expect(faqMarkdown).toContain('Canonical host: https://ogabassey.com');
    expect(contactMarkdown).toContain('https://ogabassey.com/contact');
    expect(categoryMarkdown).toContain('https://ogabassey.com/accessories');
    expect(productMarkdown).toContain(
      'https://ogabassey.com/accessories/usb-cable'
    );
  });

  it('builds the storefront FAQ mirror', () => {
    const faq = buildStorefrontFaqMarkdown(merchant, 'https://ogabassey.com');

    expect(faq).toContain('## Do you offer delivery?');
  });

  it('handles merchants without FAQ items', () => {
    const result = buildStorefrontFaqMarkdown(
      { ...merchant, faq_items: [] },
      'https://ogabassey.com'
    );

    expect(result).toContain('# FAQ');
    expect(result).not.toContain('## Do you offer delivery?');
  });

  it('falls back to legacy FAQ when structured FAQ items are invalid', () => {
    const result = buildStorefrontFaqMarkdown(
      {
        ...merchant,
        faq_items: [{ question: null, answer: 123 }],
        pages: {
          faq: 'Q: Legacy returns?\nA: Yes, within 7 days.',
        },
      },
      'https://ogabassey.com'
    );

    expect(result).toContain('## Legacy returns?');
    expect(result).toContain('Yes, within 7 days.');
  });

  it('sanitizes merchant-controlled storefront markdown fields', () => {
    const result = buildStorefrontHomeMarkdown(
      {
        ...merchant,
        business_name:
          '<script>alert(1)</script>Bad [Store](javascript:alert(1))',
        site_description: '<img src=x onerror=alert(1)> **unsafe**',
        business_type: '<b>Retail</b>',
        phone: '<script>bad</script>+2348000000000',
        email: '<b>hello@ogabassey.com</b>',
      },
      'https://ogabassey.com'
    );

    expect(result).not.toContain('<script');
    expect(result).not.toContain('[Store](javascript');
    expect(result).not.toContain('**unsafe**');
    expect(result).toContain('unsafe');
    expect(result).toContain('Retail');
    expect(result).toContain('hello@ogabassey.com');
  });

  it('uses agent availability for nullable manage_stock product markdown', () => {
    const result = buildProductMarkdown(merchant, 'https://ogabassey.com', {
      id: 'p1',
      name: 'Legacy Watch',
      slug: 'legacy-watch',
      description: 'Bluetooth smartwatch',
      price: 30600,
      category: 'Accessories',
      stock: 0,
      stock_quantity: 0,
      manage_stock: null,
      images: ['https://img.test/watch.jpg'],
    });

    expect(result).toContain('- Availability: in_stock');
    expect(result).toContain('- inventory_policy: untracked');
    expect(result).toContain('- is_purchasable: true');
    expect(result).toContain('- quantity_available: untracked');
  });

  it('treats omitted manage_stock as unmanaged stock', () => {
    const result = buildProductMarkdown(merchant, 'https://ogabassey.com', {
      id: 'p2',
      name: 'Legacy Phone',
      slug: 'legacy-phone',
      description: 'Older catalog row without explicit stock management.',
      price: 120000,
      category: 'Phones',
      stock: 0,
      stock_quantity: 0,
      images: [],
    });

    expect(result).toContain(
      '> Older catalog row without explicit stock management.'
    );
    expect(result).toContain('- Availability: in_stock');
    expect(result).toContain('- quantity_available: untracked');
    expect(result).toContain('/placeholder.svg');
  });

  it('sanitizes product-controlled markdown fields', () => {
    const result = buildProductMarkdown(merchant, 'https://ogabassey.com', {
      id: 'p5',
      name: '<script>alert(1)</script>[Phone](javascript:alert(1))',
      slug: 'unsafe-phone',
      description: '<img src=x onerror=alert(1)> **unsafe** phone',
      price: 180000,
      category: '<b>Phones</b>',
      brand: '[BadBrand](javascript:alert(1))',
      condition: '<i>new</i>',
      stock: 5,
      stock_quantity: 5,
      manage_stock: true,
      images: ['https://img.test/phone.jpg'],
    });

    expect(result).not.toContain('<script');
    expect(result).not.toContain('[Phone](javascript');
    expect(result).not.toContain('[BadBrand](javascript');
    expect(result).not.toContain('**unsafe**');
    expect(result).toContain('unsafe');
    expect(result).toContain('Phones');
    expect(result).toContain('new');
  });

  it('uses the resolved merchant currency (not a hardcoded default) in product and category markdown', () => {
    const ghMerchant: CachedMerchant = {
      ...merchant,
      payout_currency: 'GHS',
      country: 'GH',
    };
    const product = {
      id: 'p7',
      name: 'Power Bank',
      slug: 'power-bank',
      description: '20,000mAh power bank.',
      price: 350,
      compare_at_price: 400,
      category: 'Accessories',
      stock: 5,
      stock_quantity: 5,
      manage_stock: true,
      images: [],
    };

    const productMarkdown = buildProductMarkdown(
      ghMerchant,
      'https://accra-store.com',
      product
    );
    const categoryMarkdown = buildCategoryMarkdown(
      ghMerchant,
      'https://accra-store.com',
      'accessories',
      { isCollection: true, name: 'Accessories', products: [product] }
    );

    expect(productMarkdown).toContain('350 GHS');
    expect(productMarkdown).toContain('Compare at price: 400 GHS');
    expect(categoryMarkdown).toContain('350 GHS');
    expect(productMarkdown).not.toContain('NGN');
    expect(categoryMarkdown).not.toContain('NGN');
  });

  it.each([
    {
      label: 'tracked out-of-stock',
      product: {
        id: 'p3',
        name: 'Sold Out Watch',
        slug: 'sold-out-watch',
        description: 'Tracked inventory item.',
        price: 95000,
        category: 'Accessories',
        stock: 0,
        stock_quantity: 0,
        manage_stock: true,
        images: [],
      },
      expected: [
        '- Availability: out_of_stock',
        '- is_purchasable: false',
        '- quantity_available: 0',
      ],
    },
    {
      label: 'tracked in-stock',
      product: {
        id: 'p4',
        name: 'Available Watch',
        slug: 'available-watch',
        description: 'Tracked inventory item.',
        price: 125000,
        category: 'Accessories',
        stock: 4,
        stock_quantity: 4,
        manage_stock: true,
        images: [],
      },
      expected: [
        '- Availability: in_stock',
        '- is_purchasable: true',
        '- quantity_available: 4',
      ],
    },
  ])('renders $label product metadata', ({ product, expected }) => {
    const result = buildProductMarkdown(
      merchant,
      'https://ogabassey.com',
      product
    );

    for (const expectedLine of expected) {
      expect(result).toContain(expectedLine);
    }
  });

  it('renders ## Key Specifications before ## Summary when product_key_specs has valid fields', () => {
    const product = {
      id: 'p-specs',
      name: 'Flagship Phone',
      slug: 'flagship-phone',
      description: 'Super fast flagship.',
      price: 1_200_000,
      category: 'Smartphones',
      stock: 5,
      images: [],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
        screen_size_inches: 6.8,
        display_type: 'AMOLED',
        battery_mah: 5000,
        main_camera_mp: 200,
        front_camera_mp: 32,
        gpu: 'Adreno 830',
        android_version: 'Android 15',
        network_technology: '5G',
        sim_type: 'Dual SIM',
        warranty: '2 Years',
      },
    };

    const result = buildProductMarkdown(
      merchant,
      'https://ogabassey.com',
      product
    );

    expect(result).toContain('## Key Specifications');
    expect(result).toContain('- Processor: Snapdragon 8 Elite');
    expect(result).toContain('- RAM: 16GB');
    expect(result).toContain('- Storage: 512GB');
    expect(result).toContain('- Display Size: 6.8 inches');
    expect(result).toContain('- Display Type: AMOLED');
    expect(result).toContain('- Battery: 5000mAh');
    expect(result).toContain('- Main Camera: 200MP');
    expect(result).toContain('- Front Camera: 32MP');
    expect(result).toContain('- Graphics: Adreno 830');
    expect(result).toContain('- Operating System: Android 15');
    expect(result).toContain('- Network: 5G');
    expect(result).toContain('- SIM: Dual SIM');
    expect(result).toContain('- Warranty: 2 Years');

    const keySpecsIndex = result.indexOf('## Key Specifications');
    const summaryIndex = result.indexOf('## Summary');
    expect(keySpecsIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(keySpecsIndex).toBeLessThan(summaryIndex);
  });

  it('omits ## Key Specifications when product_key_specs is null or empty', () => {
    const product = {
      id: 'p-no-specs',
      name: 'Simple Case',
      slug: 'simple-case',
      description: 'Protective case.',
      price: 5000,
      category: 'Accessories',
      stock: 10,
      images: [],
      product_key_specs: null,
    };

    const result = buildProductMarkdown(
      merchant,
      'https://ogabassey.com',
      product
    );

    expect(result).not.toContain('## Key Specifications');
    expect(result).toContain('## Summary');

    const emptySpecsResult = buildProductMarkdown(
      merchant,
      'https://ogabassey.com',
      {
        ...product,
        product_key_specs: {},
      }
    );

    expect(emptySpecsResult).not.toContain('## Key Specifications');
    expect(emptySpecsResult).toContain('## Summary');
  });
});
