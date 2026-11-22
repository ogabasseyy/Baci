import { describe, expect, it } from 'vitest';
import type { ChatProductResult } from '@/ai/chat-product-result';
import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  formatChatAutoReplyProducts,
} from './chat-auto-reply-prompt';

const product = (name: string, stock: number | null) =>
  ({ name, price: 450000, stock }) as unknown as ChatProductResult;

describe('formatChatAutoReplyProducts', () => {
  it('identifies listings whose exact price depends on product options', () => {
    expect(
      formatChatAutoReplyProducts(
        [{ ...product('iPhone 13', 6), variant_model: 'sku_matrix' }],
        'NGN'
      )
    ).toContain('exact price and stock depend on selected options');
  });

  it('lists name, price and a plain stock fact', () => {
    expect(
      formatChatAutoReplyProducts(
        [
          product('Demo Phone X', 3),
          product('Demo Case', 0),
          product('Demo Cable', null),
        ],
        'NGN'
      )
    ).toBe(
      [
        '- Demo Phone X | NGN 450000 | in stock',
        '- Demo Case | NGN 450000 | out of stock',
        '- Demo Cable | NGN 450000 | availability unknown',
      ].join('\n')
    );
  });

  it('says so when nothing matched, so the model cannot invent a product', () => {
    expect(formatChatAutoReplyProducts([], 'NGN')).toBe(
      'No matching products were found.'
    );
  });

  it('shows at most five products', () => {
    const many = Array.from({ length: 9 }, (_, i) => product(`P${i}`, 1));
    expect(formatChatAutoReplyProducts(many, 'NGN').split('\n')).toHaveLength(
      5
    );
  });
});

describe('buildChatAutoReplyPrompt', () => {
  it('puts the catalog before the customer message', () => {
    const prompt = buildChatAutoReplyPrompt({
      question: 'price?',
      products: '- A',
    });
    expect(prompt.indexOf('- A')).toBeLessThan(prompt.indexOf('price?'));
  });
});

describe('CHAT_AUTO_REPLY_SYSTEM_PROMPT', () => {
  it('answers a catalog-only no-match without inventing stock or handing off', () => {
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toContain('does not need a handoff');
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toContain(
      'Do not say it is out of stock unless the catalog confirms that'
    );
  });

  it('asks the model to say what the customer is doing, so the store can add the narrow-down line itself', () => {
    for (const intent of [
      'discover',
      'recommend',
      'details',
      'add_to_cart',
      'other',
    ]) {
      expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toContain(`"${intent}"`);
    }
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toMatch(/"intent": string/);
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toMatch(/narrow/i);
  });

  it('tells the model it cannot change the cart or take orders', () => {
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toMatch(/cannot (add|change)/i);
    expect(CHAT_AUTO_REPLY_SYSTEM_PROMPT).toMatch(/cart/i);
  });
});
