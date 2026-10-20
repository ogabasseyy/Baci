import {
  orderWalletFundingIntentCreateResponseFixture,
  orderWalletFundingIntentPollResponseFixture,
} from '@baci/shared/test-fixtures/order-wallet-funding-intent';
import {
  walletOrderFundingIntentCreateResponseSchema,
  walletOrderFundingIntentPollResponseSchema,
  walletOrderFundingIntentSchema,
  walletOrderFundingIntentStatusSchema,
} from './order-wallet-funding-intent';

const validIntent = {
  currency: 'NGN',
  debitedAmount: 0,
  excessAmount: 0,
  expectedAmount: 20_000,
  expiresAt: '2026-05-27T12:00:00.000Z',
  fundedAmount: 0,
  id: '11111111-1111-4111-8111-111111111111',
  orderId: '22222222-2222-4222-8222-222222222222',
  orderPaid: false,
  remainingAmount: 20_000,
  status: 'pending',
  targetOrderAmount: 20_000,
};

const validAccount = {
  accountName: 'Ogabassey Jane',
  accountNumber: '9971002551',
  bankName: 'Paystack-Titan',
  provider: 'paystack',
};

describe('wallet order funding intent schemas', () => {
  it('parses valid intent, create, and poll payloads', () => {
    expect(walletOrderFundingIntentSchema.safeParse(validIntent).success).toBe(
      true
    );
    expect(
      walletOrderFundingIntentCreateResponseSchema.safeParse({
        account: validAccount,
        intent: validIntent,
      }).success
    ).toBe(true);
    expect(
      walletOrderFundingIntentPollResponseSchema.safeParse({
        intent: validIntent,
      }).success
    ).toBe(true);
  });

  it('parses the characterized HTTP fixtures (offset-form expiresAt)', () => {
    // Fixtures are captured from the actual web response builders and
    // carry an offset-form expiresAt; the pre-fix bare z.iso.datetime()
    // rejected this form (see the shared fixture header).
    expect(
      walletOrderFundingIntentCreateResponseSchema.safeParse(
        orderWalletFundingIntentCreateResponseFixture
      ).success
    ).toBe(true);
    expect(
      walletOrderFundingIntentPollResponseSchema.safeParse(
        orderWalletFundingIntentPollResponseFixture
      ).success
    ).toBe(true);
  });

  it('accepts every supported status', () => {
    for (const status of [
      'pending',
      'underfunded',
      'funded',
      'processing',
      'completed',
      'expired',
      'cancelled',
      'review_required',
      'failed',
    ]) {
      expect(
        walletOrderFundingIntentStatusSchema.safeParse(status).success
      ).toBe(true);
    }
  });

  it('requires core intent fields', () => {
    for (const field of [
      'currency',
      'id',
      'expectedAmount',
      'expiresAt',
      'fundedAmount',
      'orderId',
      'status',
      'targetOrderAmount',
    ]) {
      const payload = { ...validIntent } as Record<string, unknown>;
      delete payload[field];
      expect(walletOrderFundingIntentSchema.safeParse(payload).success).toBe(
        false
      );
    }
  });

  it('normalizes lowercase currency codes', () => {
    expect(
      walletOrderFundingIntentSchema.parse({
        ...validIntent,
        currency: 'ngn',
      }).currency
    ).toBe('NGN');
  });

  it('allows optional fields to be absent or present', () => {
    const { debitedAmount, excessAmount, orderPaid, remainingAmount, ...base } =
      validIntent;

    expect(walletOrderFundingIntentSchema.safeParse(base).success).toBe(true);
    expect(
      walletOrderFundingIntentSchema.safeParse({
        ...base,
        debitedAmount,
        excessAmount,
        orderPaid,
        remainingAmount,
      }).success
    ).toBe(true);
    expect(
      walletOrderFundingIntentSchema.safeParse({
        ...base,
        orderPaid: 'true',
      }).success
    ).toBe(false);
  });

  it('rejects malformed ids, dates, currency, and negative money values', () => {
    expect(
      walletOrderFundingIntentSchema.safeParse({
        ...validIntent,
        id: 'intent-123',
      }).success
    ).toBe(false);
    expect(
      walletOrderFundingIntentSchema.safeParse({
        ...validIntent,
        expiresAt: 'not-a-date',
      }).success
    ).toBe(false);
    expect(
      walletOrderFundingIntentSchema.safeParse({
        ...validIntent,
        currency: 'ng',
      }).success
    ).toBe(false);

    for (const field of [
      'debitedAmount',
      'excessAmount',
      'fundedAmount',
      'remainingAmount',
    ]) {
      expect(
        walletOrderFundingIntentSchema.safeParse({
          ...validIntent,
          [field]: -1,
        }).success
      ).toBe(false);
    }

    for (const field of ['expectedAmount', 'targetOrderAmount']) {
      expect(
        walletOrderFundingIntentSchema.safeParse({
          ...validIntent,
          [field]: 0,
        }).success
      ).toBe(false);
      expect(
        walletOrderFundingIntentSchema.safeParse({
          ...validIntent,
          [field]: -1,
        }).success
      ).toBe(false);
    }
  });
});
