import { describe, expect, it } from 'vitest';
import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import { collectProductGroundingTokens } from './ogabassey-catalog-agent-grounding-tokens';
import { hasUnreturnedProductPhrase } from './ogabassey-catalog-agent-phrase-grounding';
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

describe('ogabassey-catalog-agent-phrase-grounding', () => {
  it('validates descriptive version features and rejects cross-product or invented variant phrases', () => {
    const iphone16 = makeProduct({ id: 'iphone-16', name: 'Apple iPhone 16' });
    const iphone15Pro = makeProduct({
      id: 'iphone-15-pro',
      name: 'Apple iPhone 15 Pro',
      price: 1_100_000,
      slug: 'apple-iphone-15-pro',
    });

    const { returnedTokens, perProductTokens } = collectProductGroundingTokens([
      iphone16,
    ]);
    expect(
      hasUnreturnedProductPhrase(
        'Apple iPhone 16 is available.',
        returnedTokens,
        perProductTokens
      )
    ).toBe(false);
    expect(
      hasUnreturnedProductPhrase(
        'Fairphone 5 is available.',
        returnedTokens,
        perProductTokens
      )
    ).toBe(true);

    const imac5k = makeProduct({
      category: 'Desktops',
      description: '27-inch Retina 5K display',
      id: 'imac-1',
      name: 'Apple iMac',
      slug: 'apple-imac',
    });
    expect(
      hasGroundedProductMentions(
        'Apple iMac has a Retina 5K display at ₦1,200,000.',
        makeEvent([imac5k])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 has a Super Retina XDR display.',
        makeEvent([
          iphone16,
          { ...iphone15Pro, description: 'Super Retina XDR display' },
        ])
      )
    ).toBe(false);

    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 supports Wi-Fi 6 and Bluetooth 5.3.',
        makeEvent([
          { ...iphone16, description: 'Supports Wi-Fi 6 and Bluetooth 5.3' },
        ])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 or Apple iPhone 15 Pro.',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 vs Apple iPhone 15 Pro.',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 versus Apple iPhone 15 Pro.',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 (or Apple iPhone 15 Pro).',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 (vs Apple iPhone 15 Pro).',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 offers 256GB plus 8GB RAM.',
        makeEvent([{ ...iphone16, description: '8GB RAM and 256GB storage' }])
      )
    ).toBe(true);

    const galaxyS25WithFeatures = makeProduct({
      id: 's25',
      brand: 'Samsung',
      name: 'Samsung Galaxy S25',
      slug: 'samsung-galaxy-s25',
      description:
        'Corning Gorilla Glass 5 display and Snapdragon 8 Gen 3 chip',
    });
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 has Gorilla Glass 5 and Snapdragon 8 Gen 3.',
        makeEvent([galaxyS25WithFeatures])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 has Gorilla Glass 6.',
        makeEvent([galaxyS25WithFeatures])
      )
    ).toBe(false);
    expect(
      hasGroundedProductMentions(
        'Motorola Edge 50 plus 256GB is available.',
        makeEvent([
          makeProduct({
            id: 'edge-50',
            brand: 'Motorola',
            name: 'Motorola Edge 50',
            slug: 'motorola-edge-50',
            description: '256GB storage',
          }),
        ])
      )
    ).toBe(false);
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy A15 5G ultra is available.',
        makeEvent([
          makeProduct({
            id: 'a15-5g',
            brand: 'Samsung',
            name: 'Samsung Galaxy A15 5G',
            slug: 'samsung-galaxy-a15-5g',
          }),
        ])
      )
    ).toBe(false);
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 has Bluetooth 5 plus 8GB RAM and 5G ultra-fast connectivity.',
        makeEvent([
          {
            ...galaxyS25WithFeatures,
            description: 'Bluetooth 5, 8GB RAM, 5G connectivity',
          },
        ])
      )
    ).toBe(true);

    const macbookAirM2 = makeProduct({
      brand: 'Apple',
      category: 'Laptops',
      description: '8GB DDR4 RAM and 256GB SSD',
      id: 'mac-air-m2',
      name: 'Apple MacBook Air M2',
      slug: 'apple-macbook-air-m2',
    });
    expect(
      hasGroundedProductMentions(
        'Apple MacBook Air M2 has DDR4 RAM.',
        makeEvent([macbookAirM2])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'Apple MacBook Air M2 has LPDDR5 RAM.',
        makeEvent([macbookAirM2])
      )
    ).toBe(false);

    const kingstonDdr5 = makeProduct({
      brand: 'Kingston',
      category: 'Components',
      description: 'Not compatible with DDR4 RAM',
      id: 'kingston-ddr5',
      name: 'Kingston Fury DDR5',
      slug: 'kingston-fury-ddr5',
    });
    expect(
      hasGroundedProductMentions(
        'Kingston Fury DDR4 is available.',
        makeEvent([kingstonDdr5])
      )
    ).toBe(false);

    const hpLaptop = makeProduct({
      brand: 'HP',
      category: 'Laptops',
      description: 'Intel Core i7 processor and Intel Core Ultra 7 option',
      id: 'hp-pavilion-15',
      name: 'HP Pavilion 15',
      slug: 'hp-pavilion-15',
    });
    expect(
      hasGroundedProductMentions(
        'HP Pavilion 15 has Intel Core i7 processor.',
        makeEvent([hpLaptop])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'HP Pavilion 15 has Intel Core Ultra 7.',
        makeEvent([hpLaptop])
      )
    ).toBe(true);
    expect(
      hasGroundedProductMentions(
        'HP Pavilion 15 has Intel Core i9 processor.',
        makeEvent([hpLaptop])
      )
    ).toBe(false);

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
  });
});
