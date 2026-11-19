import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { formatFastCatalogText } from './fast-catalog-text';

const event: StorefrontAgentUiEvent = {
  type: 'present_products',
  intent: 'discover',
  title: 'Products',
  products: [
    {
      id: 'one',
      name: 'USB Charger',
      slug: 'usb-charger',
      category: 'Accessories',
      brand: null,
      description: null,
      imageUrl: null,
      stock: 1,
      manageStock: true,
      hasVariants: false,
      price: 12000,
    },
  ],
};

describe('text-only catalog results', () => {
  it('leaves messages without catalog results unchanged', () => {
    expect(
      formatFastCatalogText({ text: 'Try another search.', events: [] }, 'NGN')
    ).toBe('Try another search.');
  });

  it('still links to a product if the currency cannot be formatted', () => {
    const text = formatFastCatalogText(
      { text: 'Found a charger.', events: [event] },
      'invalid'
    );
    expect(text).toContain('https://ogabassey.com/accessories/usb-charger');
    expect(text).not.toContain('12,000');
  });
});
