import { describe, expect, it } from 'vitest';
import {
  chatwootCartQuantityMutationRequestSchema,
  chatwootCommerceChallengeRequestSchema,
  chatwootCommerceContextVerifyRequestSchema,
  chatwootCommerceSessionAuthorizeRequestSchema,
} from './chatwoot-commerce-context';

const validChallenge = {
  conversationId: 905,
  requestId: 'request_12345678',
  visitorTokenSha256: 'a'.repeat(64),
  websiteToken: 'synthetic-widget-token-123456',
};
const validQuantityMutation = {
  cartVersion: 12,
  conversationId: 905,
  expectedQuantity: 25,
  lineId: '11111111-1111-4111-8111-111111111111',
  quantity: 10,
  requestId: 'quantity-0001',
  sessionToken: 'signed-session-token',
};

describe('Chatwoot commerce request schemas', () => {
  it('pins quantity mutation boundaries and permits reducing legacy large lines', () => {
    expect(
      chatwootCartQuantityMutationRequestSchema.safeParse(validQuantityMutation)
        .success
    ).toBe(true);
    for (const [field, value] of [
      ['cartVersion', 0],
      ['cartVersion', 1.5],
      ['cartVersion', Number.MAX_SAFE_INTEGER + 1],
      ['conversationId', 0],
      ['conversationId', Number.MAX_SAFE_INTEGER + 1],
      ['expectedQuantity', 0],
      ['expectedQuantity', 1001],
      ['lineId', 'line-not-uuid'],
      ['quantity', -1],
      ['quantity', 1.5],
      ['quantity', 11],
      ['requestId', 'short'],
      ['requestId', 'r'.repeat(81)],
      ['requestId', 'has spaces'],
      ['sessionToken', ''],
      ['sessionToken', 't'.repeat(12_001)],
    ] as const) {
      expect(
        chatwootCartQuantityMutationRequestSchema.safeParse({
          ...validQuantityMutation,
          [field]: value,
        }).success
      ).toBe(false);
    }
    expect(
      chatwootCartQuantityMutationRequestSchema.safeParse({
        ...validQuantityMutation,
        merchantId: 'caller-selected',
      }).success
    ).toBe(false);
  });

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

  it('accepts only a boolean snapshot opt-in and rejects unknown authorize fields', () => {
    expect(
      chatwootCommerceSessionAuthorizeRequestSchema.safeParse({
        sessionToken: 'valid-token',
        includeCartSnapshot: true,
      }).success
    ).toBe(true);
    expect(
      chatwootCommerceSessionAuthorizeRequestSchema.safeParse({
        sessionToken: 'valid-token',
        includeCartSnapshot: false,
      }).success
    ).toBe(true);
    expect(
      chatwootCommerceSessionAuthorizeRequestSchema.safeParse({
        sessionToken: 'valid-token',
        includeCartSnapshot: 'true',
      }).success
    ).toBe(false);
    expect(
      chatwootCommerceSessionAuthorizeRequestSchema.safeParse({
        sessionToken: 'valid-token',
        merchantId: 'caller-selected',
      }).success
    ).toBe(false);
  });
});
