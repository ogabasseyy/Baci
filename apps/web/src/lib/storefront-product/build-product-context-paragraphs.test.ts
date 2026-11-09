import { describe, expect, it } from 'vitest';
import { buildProductContextParagraphs } from './build-product-context-paragraphs';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'playstation-5',
    categoryName: 'PlayStation 5',
    currentProduct: {
      slug: 'forspoken',
      name: 'Forspoken',
      price: 42_000,
      brand: 'Square Enix',
      condition: 'new',
      stock: 5,
      category_slug: 'playstation-5',
      product_key_specs: {
        platform: 'PlayStation 5',
        format: 'Physical Blu-ray disc',
        region: 'Confirm from retail box',
      },
    },
    inventory: [],
    ...overrides,
  };
}

describe('buildProductContextParagraphs', () => {
  it('builds factual PDP context copy from product, merchant, category, and link data', () => {
    expect(
      buildProductContextParagraphs({
        merchantBusinessName: 'Ogabassey',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        displayPriceText: '$950 - $1,050',
        semanticModel: {
          supportLinks: [{ href: '/smartphones', label: 'Shop Smartphones' }],
          guideLinks: [
            {
              href: '/blog/guide',
              title: 'Phone Guide',
              description: 'Phone buying guide',
              kind: 'buyer-guide',
            },
          ],
          alternatives: {
            heading: 'More smartphones',
            cards: [
              {
                title: 'iPhone 15',
                description: 'Apple option',
                href: '/smartphones/iphone-15',
              },
            ],
          },
          sameBrand: {
            heading: 'More Samsung',
            cards: [
              {
                title: 'Samsung Galaxy S24',
                description: 'Samsung option',
                href: '/smartphones/samsung-galaxy-s24',
              },
            ],
          },
          samePrice: null,
        },
        currentProduct: {
          slug: 'samsung-galaxy-s25',
          name: 'Samsung Galaxy S25',
          brand: 'Samsung',
          condition: 'open_box',
          price: 950_000,
          stock: 3,
          category_slug: 'smartphones',
          product_key_specs: {},
        },
      })
    ).toEqual([
      'Samsung Galaxy S25 is listed by Ogabassey in Smartphones, with pricing shown on this page as $950 - $1,050. Use this product page to review Open Box condition, compare the exact item details, and verify practical purchase details before checkout. Live stock, selected options and delivery timing should still be confirmed at checkout.',
      'For buyers comparing Samsung options, use the comparison links, buyer guides, same-brand options and smartphones alternatives on this page to move from Samsung Galaxy S25 to relevant options from Ogabassey. For Smartphones products, confirm the exact model, color, storage or size option, network or device compatibility, charging requirements, included accessories and warranty terms. Audio, TV, phone and smartwatch variants can differ by region, so the final checkout selection should match the retail unit you intend to receive.',
    ]);
  });

  it('falls back cleanly when optional brand, condition, stock, and display price are missing', () => {
    const paragraphs = buildProductContextParagraphs({
      merchantBusinessName: 'Ogabassey',
      categorySlug: 'portable-gaming',
      categoryName: 'Portable Gaming',
      currentProduct: {
        slug: 'steam-deck',
        name: 'Steam Deck',
        price: 800_000,
        stock: 0,
      },
    });

    expect(paragraphs[0]).toContain('review the listed condition');
    expect(paragraphs[0]).toContain('with pricing shown on this page');
    expect(paragraphs[0]).not.toContain('current price');
    expect(paragraphs[0]).toContain('may currently be out of stock');
    expect(paragraphs[1]).toContain('use the visible details on this page');
    expect(paragraphs[1]).toContain('region compatibility');
    expect(paragraphs[1]).not.toContain('related links on this page connect');
  });

  it('builds product-specific gaming context without fixed price claims', () => {
    const paragraphs = buildProductContextParagraphs(makeInput());

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.join(' ')).toContain('Forspoken');
    expect(paragraphs.join(' ')).toContain('Ogabassey');
    expect(paragraphs.join(' ')).toContain('region compatibility');
    expect(paragraphs.join(' ')).toContain('Format: Physical Blu-ray disc');
    expect(paragraphs.join(' ')).not.toMatch(/price in nigeria|installment/i);
  });

  it('uses computer-specific buyer checks for laptop and monitor categories', () => {
    const paragraphs = buildProductContextParagraphs(
      makeInput({
        categorySlug: 'gaming-laptops',
        categoryName: 'Gaming Laptops',
        currentProduct: {
          slug: 'legion-pro-5',
          name: 'Lenovo Legion Pro 5',
          price: 1_000_000,
          brand: 'Lenovo',
          condition: 'open_box',
          stock: 1,
          category_slug: 'gaming-laptops',
          product_key_specs: {
            processor: 'AMD Ryzen 7',
            ram_gb: 32,
            storage_gb: 1024,
            created_at: '2026-06-01T00:00:00Z',
          },
        },
      })
    );

    const copy = paragraphs.join(' ');
    expect(copy).toContain('processor or panel class');
    expect(copy).toContain('Open Box condition');
    expect(copy).not.toContain('open_box condition');
    expect(copy).toContain('Processor: AMD Ryzen 7');
    expect(copy).toContain('RAM: 32GB');
    expect(copy).toContain('Internal Storage: 1024GB');
    expect(copy).not.toContain('created at');
  });

  it('preserves scalar phone specs in crawl-visible structured details', () => {
    const paragraphs = buildProductContextParagraphs(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: {
          slug: 'galaxy-s24',
          name: 'Samsung Galaxy S24',
          price: 950_000,
          brand: 'Samsung',
          condition: 'new',
          stock: 3,
          category_slug: 'smartphones',
          product_key_specs: {
            created_at: '2026-06-01T00:00:00Z',
            ram_gb: 8,
            storage_gb: 256,
            battery_mah: 4000,
            has_5g: true,
            has_ois: true,
            announced_date: '2024-01-17',
            release_date: '2024-01-31',
            front_camera_mp: null,
            display_resolution: '   ',
          },
        },
      })
    );

    const copy = paragraphs.join(' ');
    expect(copy).toContain('RAM: 8GB');
    expect(copy).toContain('Internal Storage: 256GB');
    expect(copy).toContain('Capacity: 4000mAh');
    expect(copy).toContain('5G Support: Yes');
    expect(copy).toContain('OIS: Yes');
    expect(copy).not.toContain('Announced: 2024-01-17');
    expect(copy).not.toContain('created at');
    expect(copy).not.toContain('nullMP');
    expect(copy).not.toContain('Display resolution');
  });

  it('retains mobile lifecycle and recommendation facts outside the display taxonomy', () => {
    const paragraphs = buildProductContextParagraphs(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: {
          slug: 'pixel-8',
          name: 'Google Pixel 8',
          price: 800_000,
          category_slug: 'smartphones',
          product_key_specs: {
            announced_date: '2023-10-04',
            release_date: '2023-10-12',
            recommended_for: 'Everyday photography',
          },
        },
      })
    );

    const copy = paragraphs.join(' ');
    expect(copy).toContain('Announced: 2023-10-04');
    expect(copy).toContain('Release date: 2023-10-12');
    expect(copy).toContain('Recommended for: Everyday photography');
  });

  it('uses camera taxonomy and omits phone-only negative facts from camera crawl copy', () => {
    const paragraphs = buildProductContextParagraphs(
      makeInput({
        categorySlug: 'cameras',
        categoryName: 'Cameras',
        currentProduct: {
          slug: 'canon-eos-r5-mark-ii',
          name: 'Canon EOS R5 Mark II',
          price: 4_899_000,
          brand: 'Canon',
          condition: 'new',
          stock: 1,
          category_slug: 'cameras',
          product_key_specs: {
            main_camera_mp: 45,
            rear_camera_video: '8K RAW',
            has_5g: false,
            has_nfc: false,
            has_headphone_jack: false,
            has_ois: true,
            card_slot_type: 'No',
            usb_type: 'USB-C',
          },
        },
      })
    );

    const copy = paragraphs.join(' ');
    expect(copy).toContain('Effective Resolution: 45MP');
    expect(copy).toContain('Video Recording: 8K RAW');
    expect(copy).not.toContain('5G Support: No');
    expect(copy).not.toContain('NFC: No');
    expect(copy).not.toContain('3.5mm Jack: No');
    expect(copy).toContain('OIS: Yes');
    expect(copy).not.toContain('Card Slot: No');
  });

  it('classifies crawl facts from the stable category slug when the display name is localized', () => {
    const paragraphs = buildProductContextParagraphs(
      makeInput({
        categorySlug: 'action-cameras',
        categoryName: '相机',
        currentProduct: {
          slug: 'hero-action-cam',
          name: 'Hero Action Cam',
          price: 250_000,
          category_slug: 'action-cameras',
          product_key_specs: {
            main_camera_mp: 24,
            has_ois: true,
          },
        },
      })
    );

    const copy = paragraphs.join(' ');
    expect(copy).toContain('Effective Resolution: 24MP');
    expect(copy).toContain('OIS: Yes');
    expect(copy).toContain('相机');
  });
});
