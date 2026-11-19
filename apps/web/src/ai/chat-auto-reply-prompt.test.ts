import { describe, expect, it } from 'vitest';
import type { ChatProductResult } from '@/ai/chat-product-result';
import {
  buildChatAutoReplyPrompt,
  formatChatAutoReplyProducts,
} from './chat-auto-reply-prompt';

const product = (name: string, stock: number | null) =>
  ({ name, price: 450000, stock }) as unknown as ChatProductResult;

describe('formatChatAutoReplyProducts', () => {
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
