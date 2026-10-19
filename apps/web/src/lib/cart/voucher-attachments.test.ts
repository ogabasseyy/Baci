import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuizVoucherToken } from '@/lib/quiz-voucher-token';
import {
  commandVoucherLines,
  voucherAttachmentsValid,
} from './voucher-attachments';

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const AWARD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function signedToken(): string {
  return createQuizVoucherToken({
    payload: {
      awardId: AWARD_ID,
      condition: null,
      expiresAt: '2099-05-22T12:00:00.000Z',
      productId: PRODUCT_ID,
      userId: USER_ID,
      variantId: null,
    },
    secret: 'voucher-secret',
  });
}

describe('voucherAttachmentsValid', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a signed pair bound to the line', () => {
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    expect(
      voucherAttachmentsValid([
        {
          item: { productId: PRODUCT_ID },
          voucherAwardId: AWARD_ID,
          voucherToken: signedToken(),
        },
      ])
    ).toBe(true);
  });

  it('rejects a forged pair that would otherwise price at zero', () => {
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    expect(
      voucherAttachmentsValid([
        {
          item: { productId: PRODUCT_ID },
          voucherAwardId: AWARD_ID,
          voucherToken: 'qv1.forged.signature',
        },
      ])
    ).toBe(false);
  });

  it('rejects partial pairs and award/product mismatches', () => {
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    expect(
      voucherAttachmentsValid([
        { item: { productId: PRODUCT_ID }, voucherToken: signedToken() },
      ])
    ).toBe(false);
    expect(
      voucherAttachmentsValid([
        {
          item: { productId: PRODUCT_ID },
          voucherAwardId: USER_ID,
          voucherToken: signedToken(),
        },
      ])
    ).toBe(false);
    expect(
      voucherAttachmentsValid([
        {
          item: { productId: AWARD_ID },
          voucherAwardId: AWARD_ID,
          voucherToken: signedToken(),
        },
      ])
    ).toBe(false);
  });

  it('extracts voucher lines from add and replace commands only', () => {
    expect(commandVoucherLines({ type: 'clear' })).toEqual([]);
    expect(
      commandVoucherLines({
        type: 'add',
        item: { productId: PRODUCT_ID },
        voucherAwardId: AWARD_ID,
        voucherToken: 'token',
      })
    ).toHaveLength(1);
  });
});
