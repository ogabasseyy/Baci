import { describe, expect, it } from 'vitest';
import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import { hasGroundedProductMentions } from './ogabassey-catalog-agent-product-matching';

const makeProduct = (
  overrides: Partial<StorefrontAgentUiProduct>
): StorefrontAgentUiProduct => ({
  brand: 'Apple',
  category: 'Phones',
  description: 'Sample device',
  hasVariants: false,
  id: 'prod-1',
  imageUrl: 'https://cdn.example.com/p.jpg',
  manageStock: true,
  name: 'Apple iPhone 16',
  price: 1_200_000,
  slug: 'apple-iphone-16',
  stock: 4,
  ...overrides,
});

const makeEvent = (
  products: StorefrontAgentUiProduct[]
): StorefrontAgentUiEvent[] => [
  {
    intent: 'discover',
    products,
    title: 'Products I found',
    type: 'present_products',
  },
];

describe('ogabassey-catalog-agent-phrase-grounding silicon and display features', () => {
  it('grounds Apple silicon, display technologies, and brand-prefixed generic nouns', () => {
    const iphone15ProMax = makeProduct({
      id: 'iphone-15-pro-max',
      name: 'Apple iPhone 15 Pro Max',
      slug: 'apple-iphone-15-pro-max',
      description:
        'Titanium design, A17 Pro chip, and the most powerful iPhone camera system ever.',
    });
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 15 Pro Max has an A17 Pro chip.',
        makeEvent([iphone15ProMax])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 15 Pro Max has an A18 Pro chip.',
        makeEvent([iphone15ProMax])
      )
    ).toBe(false);

    const ipadAir = makeProduct({
      category: 'Tablets',
      description: 'Apple M2 chip with 8GB RAM and 256GB storage',
      id: 'ipad-air',
      name: 'Apple iPad Air',
      slug: 'apple-ipad-air',
    });
    expect(
      hasGroundedProductMentions(
        'Apple iPad Air has an M2 chip.',
        makeEvent([ipadAir])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPad Air has an M3 chip.',
        makeEvent([ipadAir])
      )
    ).toBe(false);

    const galaxyS25 = makeProduct({
      id: 's25',
      brand: 'Samsung',
      name: 'Samsung Galaxy S25',
      slug: 'samsung-galaxy-s25',
      description: 'Dynamic AMOLED 2X display',
    });
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 has a Dynamic AMOLED 2X display.',
        makeEvent([galaxyS25])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 has a Dynamic AMOLED 3X display.',
        makeEvent([galaxyS25])
      )
    ).toBe(false);

    const surfaceLaptop6 = makeProduct({
      brand: 'Microsoft',
      category: 'Laptops',
      id: 'surface-laptop-6',
      name: 'Microsoft Surface Laptop 6',
      slug: 'microsoft-surface-laptop-6',
    });
    expect(
      hasGroundedProductMentions(
        'Microsoft Surface Laptop 6 or microsoft surface laptop 7.',
        makeEvent([surfaceLaptop6])
      )
    ).toBe(false);
  });
});
