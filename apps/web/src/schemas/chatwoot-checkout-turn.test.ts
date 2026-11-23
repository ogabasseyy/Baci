import { describe, expect, it } from 'vitest';
import {
  chatwootCheckoutTurnBridgeCommandSchema,
  chatwootCheckoutTurnModelOutputSchema,
  chatwootCheckoutTurnRequestSchema,
} from './chatwoot-checkout-turn';

const VALID_REQUEST = {
  conversationId: 7,
  sessionToken: 'session-token',
  step: 'select_bank' as const,
  question: ' Which bank do you use? ',
  answer: ' GTBank ',
  options: [{ code: ' 058 ', name: ' Guaranty Trust Bank ' }],
};

describe('chatwootCheckoutTurnRequestSchema', () => {
  it('accepts a valid request and trims question, answer, and option fields', () => {
    expect(chatwootCheckoutTurnRequestSchema.safeParse(VALID_REQUEST)).toEqual({
      success: true,
      data: {
        conversationId: 7,
        sessionToken: 'session-token',
        step: 'select_bank',
        question: 'Which bank do you use?',
        answer: 'GTBank',
        options: [{ code: '058', name: 'Guaranty Trust Bank' }],
      },
    });
  });

  it('rejects unknown steps and oversized option lists', () => {
    expect(
      chatwootCheckoutTurnRequestSchema.safeParse({
        ...VALID_REQUEST,
        step: 'unknown_step',
      }).success
    ).toBe(false);

    expect(
      chatwootCheckoutTurnRequestSchema.safeParse({
        ...VALID_REQUEST,
        options: Array.from({ length: 201 }, (_, i) => ({
          code: `C${i}`,
          name: `Bank ${i}`,
        })),
      }).success
    ).toBe(false);
  });
});

describe('chatwootCheckoutTurnBridgeCommandSchema', () => {
  it('requires a UUID requestId', () => {
    expect(
      chatwootCheckoutTurnBridgeCommandSchema.safeParse({
        ...VALID_REQUEST,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      }).success
    ).toBe(true);

    expect(
      chatwootCheckoutTurnBridgeCommandSchema.safeParse({
        ...VALID_REQUEST,
        requestId: 'bad',
      }).success
    ).toBe(false);
  });
});

describe('chatwootCheckoutTurnModelOutputSchema', () => {
  it('falls back malformed optional fields to null without failing valid intent', () => {
    expect(
      chatwootCheckoutTurnModelOutputSchema.safeParse({
        intent: 'select_option',
        selectedCode: 58,
        extractedValue: ['bad'],
        reply: { text: 'oops' },
      })
    ).toEqual({
      success: true,
      data: {
        intent: 'select_option',
        selectedCode: null,
        extractedValue: null,
        reply: null,
      },
    });
  });
});
