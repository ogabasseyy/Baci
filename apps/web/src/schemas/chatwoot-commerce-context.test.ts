import { describe, expect, it } from 'vitest';
import {
  chatwootCommerceChallengeRequestSchema,
  chatwootCommerceContextVerifyRequestSchema,
  chatwootCommerceSessionAuthorizeRequestSchema,
  chatwootCartReviewSnapshotSchema,
} from './chatwoot-commerce-context';

const validChallenge = {
  conversationId: 905,
  requestId: 'request_12345678',
  visitorTokenSha256: 'a'.repeat(64),
  websiteToken: 'synthetic-widget-token-123456',
};

describe('Chatwoot commerce request schemas', () => {
  it('accepts valid challenge input and rejects additional tenant selectors', () => {
    expect(
      chatwootCommerceChallengeRequestSchema.safeParse(validChallenge).success
    ).toBe(true);
    expect(
      chatwootCommerceChallengeRequestSchema.safeParse({
        ...validChallenge,
        merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
      }).success
    ).toBe(false);
  });

  it('bounds challenge identifiers and digest format', () => {
    for (const conversationId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        chatwootCommerceChallengeRequestSchema.safeParse({
          ...validChallenge,
          conversationId,
        }).success
      ).toBe(false);
    }
    for (const requestId of ['short', 'r'.repeat(81)]) {
      expect(
        chatwootCommerceChallengeRequestSchema.safeParse({
          ...validChallenge,
          requestId,
        }).success
      ).toBe(false);
    }
    for (const websiteToken of ['too-short', 'w'.repeat(129)]) {
      expect(
        chatwootCommerceChallengeRequestSchema.safeParse({
          ...validChallenge,
          websiteToken,
        }).success
      ).toBe(false);
    }
    expect(
      chatwootCommerceChallengeRequestSchema.safeParse({
        ...validChallenge,
        visitorTokenSha256: 'A'.repeat(64),
      }).success
    ).toBe(false);
  });

  it('rejects empty, oversized, and unknown token fields', () => {
    for (const token of ['', 't'.repeat(12_001)]) {
      expect(
        chatwootCommerceContextVerifyRequestSchema.safeParse({
          challengeToken: token,
          contextToken: 'valid-token',
        }).success
      ).toBe(false);
      expect(
        chatwootCommerceSessionAuthorizeRequestSchema.safeParse({
          sessionToken: token,
        }).success
      ).toBe(false);
    }
    expect(
      chatwootCommerceContextVerifyRequestSchema.safeParse({
        challengeToken: 'challenge',
        contextToken: 'context',
        merchantId: 'caller-selected',
      }).success
    ).toBe(false);
  });
});

describe('chatwootCartReviewSnapshotSchema', () => {
  const snapshot = {
    cartVersion: 1,
    currency: 'NGN',
    estimatedTotals: false,
    items: [
      {
        lineId: 'line-1',
        name: 'Phone',
        productId: 'product-1',
        variantId: null,
        condition: null,
        quantity: 2,
        unitPriceMinor: 100,
        lineTotalMinor: 200,
      },
    ],
    itemsSubtotalMinor: 200,
  };

  it('accepts a bounded canonical cart snapshot', () => {
    expect(chatwootCartReviewSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it.each([
    ['unsupported currency format', { ...snapshot, currency: 'NG' }],
    ['negative version', { ...snapshot, cartVersion: -1 }],
    ['unknown field', { ...snapshot, checkoutSessionId: 'secret' }],
    [
      'invalid nullable field type',
      { ...snapshot, items: [{ ...snapshot.items[0], variantId: 42 }] },
    ],
    ['too many cart lines', { ...snapshot, items: Array(21).fill(snapshot.items[0]) }],
  ])('rejects %s', (_label, value) => {
    expect(chatwootCartReviewSnapshotSchema.safeParse(value).success).toBe(false);
  });
});
