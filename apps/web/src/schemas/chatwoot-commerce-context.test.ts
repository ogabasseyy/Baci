import { describe, expect, it } from 'vitest';
import {
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
