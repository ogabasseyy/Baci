import { describe, expect, it } from 'vitest';
import {
  chatwootDeliveryConfirmationInputSchema,
  chatwootDeliveryDecisionSchema,
  chatwootDeliveryInputClassificationSchema,
} from './chatwoot-delivery-confirmation';

const VALID_SCOPE = {
  conversationId: 12,
  sessionToken: 'session-token',
};

const VALID_MATCH = {
  placeId: 'ChIJ123',
  label: '14 Admiralty Way, Lekki Phase 1, Lagos',
  googleSession: '550e8400-e29b-41d4-a716-446655440000',
  expiresAt: 1_800_000_000_000,
  proof: 'a'.repeat(64),
};

describe('chatwootDeliveryConfirmationInputSchema', () => {
  it('accepts search and decide payloads', () => {
    expect(
      chatwootDeliveryConfirmationInputSchema.safeParse({
        ...VALID_SCOPE,
        action: 'search',
        address: ' 14 Admiralty Way, Lekki ',
      })
    ).toEqual({
      success: true,
      data: {
        ...VALID_SCOPE,
        action: 'search',
        address: '14 Admiralty Way, Lekki',
      },
    });

    expect(
      chatwootDeliveryConfirmationInputSchema.safeParse({
        ...VALID_SCOPE,
        action: 'decide',
        answer: ' Yes, that is right ',
        match: VALID_MATCH,
      }).success
    ).toBe(true);
  });

  it('rejects short search addresses and invalid HMAC proof hex', () => {
    expect(
      chatwootDeliveryConfirmationInputSchema.safeParse({
        ...VALID_SCOPE,
        action: 'search',
        address: 'ab',
      }).success
    ).toBe(false);

    expect(
      chatwootDeliveryConfirmationInputSchema.safeParse({
        ...VALID_SCOPE,
        action: 'decide',
        answer: 'yes',
        match: { ...VALID_MATCH, proof: 'not-hex' },
      }).success
    ).toBe(false);
  });
});

describe('chatwoot delivery classification schemas', () => {
  it('accepts supported decision enum values and rejects unknown values', () => {
    expect(
      chatwootDeliveryDecisionSchema.safeParse({ decision: 'confirmed' })
        .success
    ).toBe(true);
    expect(
      chatwootDeliveryDecisionSchema.safeParse({ decision: 'other' }).success
    ).toBe(false);
    expect(
      chatwootDeliveryInputClassificationSchema.safeParse({
        decision: 'side_question',
      }).success
    ).toBe(true);
    expect(
      chatwootDeliveryInputClassificationSchema.safeParse({
        decision: 'confirmed',
      }).success
    ).toBe(false);
  });
});
