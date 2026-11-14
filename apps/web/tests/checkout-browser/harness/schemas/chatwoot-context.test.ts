import { describe, expect, it } from 'vitest';
import { chatwootContextRequestSchemas } from './chatwoot-context';

const validChallenge = {
  conversationId: 905,
  requestId: 'fixture_context_123456',
  visitorTokenSha256: 'b'.repeat(64),
  websiteToken: 'synthetic-widget-token-123456',
};

describe('Chatwoot context request schemas', () => {
  it('accepts valid requests for each endpoint', () => {
    expect(
      chatwootContextRequestSchemas.challenge.safeParse(validChallenge).success
    ).toBe(true);
    expect(
      chatwootContextRequestSchemas.verify.safeParse({
        challengeToken: 'synthetic-challenge-token',
        contextToken: 'synthetic-context-token',
      }).success
    ).toBe(true);
    expect(
      chatwootContextRequestSchemas.authorize.safeParse({
        includeCartSnapshot: true,
        sessionToken: 'synthetic-session-capability',
      }).success
    ).toBe(true);
  });

  it('requires challenge identifiers and a 64-character hexadecimal digest', () => {
    expect(
      chatwootContextRequestSchemas.challenge.safeParse({
        ...validChallenge,
        conversationId: 0,
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.challenge.safeParse({
        ...validChallenge,
        visitorTokenSha256: 'z'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.challenge.safeParse({
        ...validChallenge,
        visitorTokenSha256: 'b'.repeat(63),
      }).success
    ).toBe(false);
  });

  it('rejects unknown keys on every endpoint', () => {
    expect(
      chatwootContextRequestSchemas.challenge.safeParse({
        ...validChallenge,
        merchantId: 'untrusted-merchant',
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.verify.safeParse({
        challengeToken: 'synthetic-challenge-token',
        contextToken: 'synthetic-context-token',
        merchantId: 'untrusted-merchant',
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.authorize.safeParse({
        includeCartSnapshot: true,
        sessionToken: 'synthetic-session-capability',
        merchantId: 'untrusted-merchant',
      }).success
    ).toBe(false);
  });

  it('rejects invalid verify and authorize field types', () => {
    expect(
      chatwootContextRequestSchemas.verify.safeParse({
        challengeToken: 123,
        contextToken: 'synthetic-context-token',
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.verify.safeParse({
        challengeToken: 'synthetic-challenge-token',
        contextToken: null,
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.authorize.safeParse({
        includeCartSnapshot: 'true',
        sessionToken: 'synthetic-session-capability',
      }).success
    ).toBe(false);
    expect(
      chatwootContextRequestSchemas.authorize.safeParse({
        includeCartSnapshot: true,
        sessionToken: 123,
      }).success
    ).toBe(false);
  });
});
