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

  it('does not call an unmanaged-inventory product out of stock', () => {
    const unmanaged = {
      name: 'Demo Service',
      price: 1000,
      stock: 0,
      manage_stock: false,
    } as unknown as ChatProductResult;
    expect(formatChatAutoReplyProducts([unmanaged], 'NGN')).toBe(
      '- Demo Service | NGN 1000 | in stock'
    );
  });

  it('never calls a product out of stock when its inventory lives on its options', () => {
    const variants = {
      name: 'Demo Phone',
      price: 450000,
      stock: 0,
      has_variants: true,
    } as unknown as ChatProductResult;
    const offers = {
      name: 'Demo Laptop',
      price: 900000,
      stock: 0,
      has_condition_offers: true,
    } as unknown as ChatProductResult;
    expect(formatChatAutoReplyProducts([variants, offers], 'NGN')).toBe(
      [
        '- Demo Phone | base price NGN 450000, exact price depends on the option chosen | availability depends on the option chosen',
        '- Demo Laptop | base price NGN 900000, exact price depends on the option chosen | availability depends on the option chosen',
      ].join('\n')
    );
  });

  it('never presents the parent price or parent stock of an option product as exact', () => {
    const variants = {
      name: 'Demo Phone',
      price: 100000,
      stock: 4,
      has_variants: true,
    } as unknown as ChatProductResult;
    expect(formatChatAutoReplyProducts([variants], 'NGN')).toBe(
      '- Demo Phone | base price NGN 100000, exact price depends on the option chosen | availability depends on the option chosen'
    );
  });

  it('does not call an option product in stock just because its parent is unmanaged', () => {
    const offers = {
      name: 'Demo Tablet',
      price: 200000,
      stock: 0,
      manage_stock: false,
      has_condition_offers: true,
    } as unknown as ChatProductResult;
    expect(formatChatAutoReplyProducts([offers], 'NGN')).toBe(
      '- Demo Tablet | base price NGN 200000, exact price depends on the option chosen | availability depends on the option chosen'
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
