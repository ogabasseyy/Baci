import { describe, expect, it } from 'vitest';
import {
  chatwootBankBridgeCommandSchema,
  chatwootBankVerificationRequestSchema,
} from './chatwoot-bank-verification';

const VALID_SCOPE = {
  conversationId: 42,
  sessionToken: 'session-token-123',
};
const VALID_REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('chatwootBankVerificationRequestSchema', () => {
  it('accepts banks and resolve requests and trims bankCode and phone', () => {
    expect(
      chatwootBankVerificationRequestSchema.safeParse({
        ...VALID_SCOPE,
        action: 'banks',
      }).success
    ).toBe(true);

    expect(
      chatwootBankVerificationRequestSchema.safeParse({
        ...VALID_SCOPE,
        action: 'resolve',
        bankCode: ' 058 ',
        accountNumber: '0123456789',
        phone: ' +2348012345678 ',
      })
    ).toEqual({
      success: true,
      data: {
        ...VALID_SCOPE,
        action: 'resolve',
        bankCode: '058',
        accountNumber: '0123456789',
        phone: '+2348012345678',
      },
    });
  });

  it.each([
    [
      'non-10-digit accountNumber',
      {
        ...VALID_SCOPE,
        action: 'resolve',
        bankCode: '058',
        accountNumber: '12345',
        phone: '08012345678',
      },
    ],
    [
      'short phone',
      {
        ...VALID_SCOPE,
        action: 'resolve',
        bankCode: '058',
        accountNumber: '0123456789',
        phone: '08012345',
      },
    ],
    [
      'non-positive conversationId',
      {
        conversationId: 0,
        sessionToken: 'token',
        action: 'banks',
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(
      chatwootBankVerificationRequestSchema.safeParse(payload).success
    ).toBe(false);
  });
});

describe('chatwootBankBridgeCommandSchema', () => {
  it('requires a valid UUID requestId', () => {
    expect(
      chatwootBankBridgeCommandSchema.safeParse({
        ...VALID_SCOPE,
        action: 'banks',
        requestId: VALID_REQUEST_ID,
      }).success
    ).toBe(true);

    expect(
      chatwootBankBridgeCommandSchema.safeParse({
        ...VALID_SCOPE,
        action: 'banks',
        requestId: 'not-a-uuid',
      }).success
    ).toBe(false);
  });
});
