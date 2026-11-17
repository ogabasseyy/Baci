import { describe, expect, it } from 'vitest';
import type {
  StorefrontAgentUiEvent,
  StorefrontAgentUiProduct,
} from '@/schemas/storefront-agent-ui-contract';
import { hasPositiveEmptyClauseViolation } from './ogabassey-catalog-agent-grounding';
import {
  findBoundProducts,
  hasGroundedProductMentions,
} from './ogabassey-catalog-agent-product-matching';

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

describe('ogabassey-catalog-agent-product-matching', () => {
  it('requires claimed brand and exact model identity to match returned products', () => {
    const iphone16 = makeProduct({
      id: 'iphone-16',
      name: 'Apple iPhone 16',
      brand: 'Apple',
      price: 1_200_000,
    });
    const galaxyS25 = makeProduct({
      id: 's25',
      name: 'Samsung Galaxy S25',
      brand: 'Samsung',
      price: 900_000,
      slug: 'samsung-galaxy-s25',
    });
    const events = makeEvent([iphone16, galaxyS25]);

    // Cross-brand hallucination ("Apple Galaxy S25") must fail
    expect(
      hasGroundedProductMentions('Apple Galaxy S25 is ₦900,000.', events)
    ).toBe(false);

    // Lowercase unreturned product alongside valid product must fail
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 or fairphone 5 is ₦1,200,000.',
        events
      )
    ).toBe(false);

    // Mixed negated + positive unreturned product joined with "and" must fail
    expect(
      hasGroundedProductMentions(
        "We don't have Apple iPhone 16 and Fairphone 5 is available for ₦1,200,000.",
        events
      )
    ).toBe(false);

    // Valid comparison mentioning both genuine products passes
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 is ₦1,200,000 and Samsung Galaxy S25 is ₦900,000.',
        events
      )
    ).toBe(true);

    // Unreturned single-token product family in a positive clause must fail
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 is ₦1,200,000. Chromebook is available too.',
        events
      )
    ).toBe(false);

    // Cross-product variant synthesis ("iPhone 16" + "iPhone 15 Pro" -> "iPhone 16 Pro") must fail
    const iphone15Pro = makeProduct({
      id: 'iphone-15-pro',
      name: 'Apple iPhone 15 Pro',
      price: 1_100_000,
      slug: 'apple-iphone-15-pro',
    });
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 Pro is ₦1,200,000.',
        makeEvent([iphone16, iphone15Pro])
      )
    ).toBe(false);

    // Prose uses of tier tokens ("max budget", "studio use", "plus charger") must not overblock
    expect(
      hasGroundedProductMentions(
        'Samsung Galaxy S25 fits your max budget.',
        makeEvent([galaxyS25])
      )
    ).toBe(true);
    const sonyHeadphones = makeProduct({
      brand: 'Sony',
      category: 'Audio',
      id: 'sony-xm5',
      name: 'Sony WH-1000XM5',
      slug: 'sony-wh-1000xm5',
    });
    expect(
      hasGroundedProductMentions(
        'Sony WH-1000XM5 headphones for studio use are available.',
        makeEvent([sonyHeadphones])
      )
    ).toBe(true);
    const hpLaptop = makeProduct({
      brand: 'HP',
      category: 'Laptops',
      id: 'hp-pavilion',
      name: 'HP Pavilion Laptop',
      slug: 'hp-pavilion-laptop',
    });
    expect(
      hasGroundedProductMentions(
        'HP Pavilion Laptop plus charger is ₦850,000.',
        makeEvent([hpLaptop])
      )
    ).toBe(true);

    // Descriptive features & colors from a single product's description are valid
    const macbookMidnight = makeProduct({
      brand: 'Apple',
      category: 'Laptops',
      description: 'Midnight Black aluminum MacBook with Retina display',
      id: 'mac-air',
      name: 'Apple MacBook Air',
      slug: 'apple-macbook-air',
    });
    expect(
      hasGroundedProductMentions(
        'Midnight Black MacBook Air is ₦1,450,000.',
        makeEvent([macbookMidnight])
      )
    ).toBe(true);
    const iphoneXdr = makeProduct({
      ...iphone16,
      description: 'Features Super Retina XDR display',
    });
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16 has a Super Retina XDR display at ₦1,200,000.',
        makeEvent([iphoneXdr])
      )
    ).toBe(true);
    // Cross-product color/description synthesis and description-only model names still fail closed
    expect(
      hasGroundedProductMentions(
        'Titanium Apple iPhone 16 is ₦1,200,000.',
        makeEvent([
          iphone16,
          { ...iphone15Pro, description: 'Titanium frame finish' },
        ])
      )
    ).toBe(false);
    expect(
      hasGroundedProductMentions(
        'Apple iPhone 16. Apple iPhone 15 Pro.',
        makeEvent([
          { ...iphone16, description: 'Compare with Apple iPhone 15 Pro' },
        ])
      )
    ).toBe(false);

    // Numeric display/spec features in description pass while cross-product features stay bound to clause product
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
  });

  it('binds all products in a grouped comma-separated clause', () => {
    const iphone16 = makeProduct({ id: 'iphone-16', name: 'Apple iPhone 16' });
    const iphone15 = makeProduct({
      id: 'iphone-15',
      name: 'Apple iPhone 15',
      price: 900_000,
    });

    const sentence = 'Apple iPhone 16, Apple iPhone 15 are both ₦900,000.';
    const offset = sentence.indexOf('₦900,000');
    const bound = findBoundProducts(sentence, offset, [iphone16, iphone15]);

    expect(bound.map((p) => p.id)).toEqual(['iphone-16', 'iphone-15']);
  });

  it('flags positive availability or product claims mixed into negated empty clauses', () => {
    expect(
      hasPositiveEmptyClauseViolation(
        "We don't have MacBooks and Dell XPS 15 is available now."
      )
    ).toBe(true);
    expect(
      hasPositiveEmptyClauseViolation(
        "We don't have MacBooks we have Dell XPS 15."
      )
    ).toBe(true);
    expect(
      hasPositiveEmptyClauseViolation(
        "Sorry, I couldn't find any matching laptops right now."
      )
    ).toBe(false);
    expect(
      hasPositiveEmptyClauseViolation(
        "I couldn't find iPhone 16 and iPhone 15."
      )
    ).toBe(false);
  });
});
