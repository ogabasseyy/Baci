import { describe, expect, it } from 'vitest';
import {
  CHAT_AUTO_REPLY_MAX_LENGTH,
  chatAutoReplySchema,
  checkoutNameDecisionSchema,
  checkoutNameSchema,
} from './chat-auto-reply';

const validBaseReply = {
  reply: 'Yes.',
  confidence: 0.8,
  needsHuman: false,
};

describe('chatAutoReplySchema', () => {
  it('accepts a reply with a confidence and leaves optional shopping fields omitted', () => {
    const parsed = chatAutoReplySchema.safeParse({
      reply: ' Yes. ',
      confidence: 0.8,
      needsHuman: false,
    });
    expect(parsed).toMatchObject({ success: true, data: { reply: 'Yes.' } });
    if (parsed.success) {
      expect(parsed.data.intent).toBeUndefined();
      expect(parsed.data.suggestions).toBeUndefined();
      expect(parsed.data.researchTopic).toBeUndefined();
      expect(parsed.data.checkoutHelp).toBeUndefined();
      expect(parsed.data.orderHelp).toBeUndefined();
      expect(parsed.data.cartAdd).toBeUndefined();
      expect(parsed.data.cartOptions).toBeUndefined();
      expect(parsed.data.catalogCategory).toBeUndefined();
      expect(parsed.data.cartProductQuery).toBeUndefined();
      expect(parsed.data.productSlugs).toBeUndefined();
    }
  });

  it.each([
    ['confidence above 1', { reply: 'x', confidence: 1.2, needsHuman: false }],
    [
      'negative confidence',
      { reply: 'x', confidence: -0.1, needsHuman: false },
    ],
    ['missing needsHuman', { reply: 'x', confidence: 0.5 }],
    [
      'a string confidence',
      { reply: 'x', confidence: 'high', needsHuman: false },
    ],
    [
      'an over-long reply',
      {
        reply: 'x'.repeat(CHAT_AUTO_REPLY_MAX_LENGTH + 1),
        confidence: 0.5,
        needsHuman: false,
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(chatAutoReplySchema.safeParse(value).success).toBe(false);
  });

  it('keeps a known intent', () => {
    expect(
      chatAutoReplySchema.safeParse({
        ...validBaseReply,
        intent: 'add_to_cart',
      })
    ).toMatchObject({ success: true, data: { intent: 'add_to_cart' } });
  });

  it('ignores an unknown intent instead of failing the whole reply', () => {
    const parsed = chatAutoReplySchema.safeParse({
      ...validBaseReply,
      intent: 'greeting',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.intent).toBeUndefined();
  });

  it('accepts valid shopping-action fields and trims string values at max boundaries', () => {
    const maxCartOptions = Array.from({ length: 8 }, (_, index) => ({
      axis: ` ${'a'.repeat(40)} `,
      value: ` ${String(index)}${'v'.repeat(79)} `,
    }));
    const parsed = chatAutoReplySchema.safeParse({
      ...validBaseReply,
      suggestions: ['pay_small_small', 'review_checkout'],
      researchTopic: 'MagSafe support',
      checkoutHelp: true,
      orderHelp: false,
      cartAdd: true,
      cartOptions: maxCartOptions,
      catalogCategory: 'smartphones',
      cartProductQuery: ` ${'i'.repeat(100)} `,
      productSlugs: ['a'.repeat(160), 'iphone-13', 'samsung-s24'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.suggestions).toEqual([
        'pay_small_small',
        'review_checkout',
      ]);
      expect(parsed.data.researchTopic).toBe('MagSafe support');
      expect(parsed.data.checkoutHelp).toBe(true);
      expect(parsed.data.orderHelp).toBe(false);
      expect(parsed.data.cartAdd).toBe(true);
      expect(parsed.data.cartOptions).toHaveLength(8);
      expect(parsed.data.cartOptions?.[0]).toEqual({
        axis: 'a'.repeat(40),
        value: `0${'v'.repeat(79)}`,
      });
      expect(parsed.data.catalogCategory).toBe('smartphones');
      expect(parsed.data.cartProductQuery).toBe('i'.repeat(100));
      expect(parsed.data.productSlugs).toEqual([
        'a'.repeat(160),
        'iphone-13',
        'samsung-s24',
      ]);
    }
  });

  it.each([
    ['suggestions with unknown value', 'suggestions', ['unknown_action']],
    [
      'suggestions exceeding max 2 items',
      'suggestions',
      ['browse_phones', 'compare_products', 'orders'],
    ],
    ['unknown researchTopic', 'researchTopic', 'warranty policy'],
    ['non-boolean checkoutHelp', 'checkoutHelp', 'yes'],
    ['non-boolean orderHelp', 'orderHelp', 1],
    ['non-boolean cartAdd', 'cartAdd', 'true'],
    [
      'cartOptions with blank axis',
      'cartOptions',
      [{ axis: '   ', value: 'Blue' }],
    ],
    [
      'cartOptions with over-long axis (>40)',
      'cartOptions',
      [{ axis: 'a'.repeat(41), value: 'Blue' }],
    ],
    [
      'cartOptions with over-long value (>80)',
      'cartOptions',
      [{ axis: 'Color', value: 'v'.repeat(81) }],
    ],
    [
      'cartOptions exceeding max 8 entries',
      'cartOptions',
      Array.from({ length: 9 }, (_, index) => ({
        axis: `Axis${index}`,
        value: `Val${index}`,
      })),
    ],
    ['unsupported catalogCategory', 'catalogCategory', 'accessories'],
    ['blank cartProductQuery', 'cartProductQuery', '   '],
    ['over-long cartProductQuery (>100)', 'cartProductQuery', 'q'.repeat(101)],
    [
      'productSlugs exceeding max 3 items',
      'productSlugs',
      ['a', 'b', 'c', 'd'],
    ],
    [
      'productSlugs with over-long slug (>160)',
      'productSlugs',
      ['s'.repeat(161)],
    ],
  ] as const)('falls back to undefined for %s without failing the reply', (_label, field, badValue) => {
    const parsed = chatAutoReplySchema.safeParse({
      ...validBaseReply,
      [field]: badValue,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[field]).toBeUndefined();
    }
  });
});

describe('checkoutNameSchema and checkoutNameDecisionSchema', () => {
  it('trims valid first and last names up to 60 chars', () => {
    expect(
      checkoutNameSchema.safeParse({
        firstName: ' Ada ',
        lastName: ` ${'O'.repeat(60)} `,
      })
    ).toEqual({
      success: true,
      data: { firstName: 'Ada', lastName: 'O'.repeat(60) },
    });
  });

  it('rejects empty or over-long names', () => {
    expect(
      checkoutNameSchema.safeParse({ firstName: '  ', lastName: 'Obi' }).success
    ).toBe(false);
    expect(
      checkoutNameSchema.safeParse({
        firstName: 'A'.repeat(61),
        lastName: 'Obi',
      }).success
    ).toBe(false);
  });

  it('accepts a null checkoutName decision', () => {
    expect(
      checkoutNameDecisionSchema.safeParse({ checkoutName: null })
    ).toEqual({
      success: true,
      data: { checkoutName: null },
    });
  });
});
