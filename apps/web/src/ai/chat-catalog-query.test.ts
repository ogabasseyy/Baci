import { describe, expect, it } from 'vitest';
import { extractChatCatalogSearchQuery } from './chat-catalog-query';

describe('extractChatCatalogSearchQuery', () => {
  it('extracts product model terms from conversational stock questions', () => {
    expect(
      extractChatCatalogSearchQuery(
        '[SYNTHETIC QA TEST] Hi Ekaette, what iPhone 16 options do you have in stock?'
      )
    ).toBe('iPhone 16');
  });

  it('extracts product terms from add-to-cart and checkout sentences', () => {
    expect(
      extractChatCatalogSearchQuery(
        'Can I add an iPhone 15 Pro Max 256GB to my cart and check out here?'
      )
    ).toBe('iPhone 15 Pro Max 256GB');
  });

  it('returns empty string for filler-only greetings', () => {
    expect(
      extractChatCatalogSearchQuery('Hi Ekaette, can you help me please?')
    ).toBe('');
  });

  it('returns empty string for bare numeric references without a brand/model token', () => {
    expect(extractChatCatalogSearchQuery("okay I'll take the 13")).toBe('');
  });

  it('caps extracted tokens to avoid over-constrained queries', () => {
    expect(
      extractChatCatalogSearchQuery(
        'Samsung Galaxy S24 Ultra 512GB Titanium Gray Unlocked Dual SIM'
      )
    ).toBe('Samsung Galaxy S24 Ultra 512GB Titanium Gray Unlocked');
  });
});
