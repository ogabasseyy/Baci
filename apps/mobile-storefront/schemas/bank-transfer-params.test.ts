import {
  type BankTransferParams,
  BankTransferParamsSchema,
  type WalletFundedBankTransferParams,
  WalletFundedBankTransferParamsSchema,
} from './bank-transfer-params';

const validLegacyParams = {
  accountName: 'Jane Doe',
  accountNumber: '1234567890',
  amount: '20000',
  bankName: 'Paystack-Titan',
  orderId: 'order-1',
  reference: 'ref-1',
};

const validWalletFundedParams = {
  accountName: 'Jane Doe',
  accountNumber: '1234567890',
  amount: '20000',
  bankName: 'Paystack-Titan',
  intentId: 'intent-1',
  merchantSlug: 'ogabassey',
  orderId: 'order-1',
  walletFunded: 'true',
};

describe('bank transfer param schemas', () => {
  it('validates legacy bank transfer params', () => {
    expect(BankTransferParamsSchema.safeParse(validLegacyParams).success).toBe(
      true
    );
    expect(
      BankTransferParamsSchema.safeParse({
        ...validLegacyParams,
        reference: undefined,
      }).success
    ).toBe(false);
  });

  it('validates wallet-funded bank transfer params', () => {
    expect(
      WalletFundedBankTransferParamsSchema.safeParse(validWalletFundedParams)
        .success
    ).toBe(true);
    expect(
      WalletFundedBankTransferParamsSchema.safeParse({
        ...validWalletFundedParams,
        intentId: undefined,
      }).success
    ).toBe(false);
  });

  it.each([
    {
      label: 'coerces string totals to numbers',
      orderTotal: '470000',
      expected: 470000,
    },
    { label: 'accepts numeric totals', orderTotal: 470000, expected: 470000 },
    { label: 'accepts a zero total', orderTotal: '0', expected: 0 },
    {
      label: 'treats blank totals as absent',
      orderTotal: '   ',
      expected: undefined,
    },
  ])('orderTotal $label', ({ orderTotal, expected }) => {
    for (const schema of [
      BankTransferParamsSchema,
      WalletFundedBankTransferParamsSchema,
    ]) {
      const base =
        schema === BankTransferParamsSchema
          ? validLegacyParams
          : validWalletFundedParams;
      const result = schema.safeParse({ ...base, orderTotal });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderTotal).toBe(expected);
      }
    }
  });

  it.each([
    ['-1'],
    ['NaN'],
    ['Infinity'],
  ])('rejects non-finite or negative orderTotal %s', (orderTotal) => {
    for (const schema of [
      BankTransferParamsSchema,
      WalletFundedBankTransferParamsSchema,
    ]) {
      const base =
        schema === BankTransferParamsSchema
          ? validLegacyParams
          : validWalletFundedParams;
      expect(schema.safeParse({ ...base, orderTotal }).success).toBe(false);
    }
  });

  it.each([
    ['accountName', 'Account name is required'],
    ['accountNumber', 'Account number is required'],
    ['amount', 'Amount is required'],
    ['bankName', 'Bank name is required'],
    ['orderId', 'Order ID is required'],
    ['reference', 'Reference is required'],
  ])('rejects missing legacy %s', (field, message) => {
    const params = { ...validLegacyParams };
    delete params[field as keyof typeof params];
    const result = BankTransferParamsSchema.safeParse(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(message);
    }
  });

  it('rejects whitespace-only required params and trims tracking tokens', () => {
    expect(
      BankTransferParamsSchema.safeParse({
        ...validLegacyParams,
        amount: '   ',
      }).success
    ).toBe(false);

    const result = BankTransferParamsSchema.safeParse({
      ...validLegacyParams,
      trackingToken: ' token ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trackingToken).toBe('token');
    }
  });

  it('trims required legacy params', () => {
    expect(
      BankTransferParamsSchema.parse({
        accountName: ' Jane Doe ',
        accountNumber: ' 1234567890 ',
        amount: ' 20000 ',
        bankName: ' Paystack-Titan ',
        orderId: ' order-1 ',
        reference: ' ref-1 ',
      })
    ).toMatchObject(validLegacyParams);
  });

  it('trims wallet-funded merchant and tracking fields', () => {
    expect(
      WalletFundedBankTransferParamsSchema.parse({
        ...validWalletFundedParams,
        accountName: ' Jane Doe ',
        accountNumber: ' 1234567890 ',
        amount: ' 20000 ',
        bankName: ' Paystack-Titan ',
        intentId: ' intent-1 ',
        merchantId: ' merchant-1 ',
        merchantSlug: ' ogabassey ',
        orderId: ' order-1 ',
        trackingToken: ' token ',
      })
    ).toMatchObject({
      accountName: 'Jane Doe',
      accountNumber: '1234567890',
      amount: '20000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
      trackingToken: 'token',
    });
  });

  it.each([
    'accountName',
    'accountNumber',
    'amount',
    'bankName',
    'orderId',
    'intentId',
  ])('rejects blank wallet-funded %s', (field) => {
    expect(
      WalletFundedBankTransferParamsSchema.safeParse({
        ...validWalletFundedParams,
        [field]: ' ',
      }).success
    ).toBe(false);
  });

  it('keeps wallet-funded optional fields optional', () => {
    const parsed = WalletFundedBankTransferParamsSchema.parse({
      accountName: 'Jane Doe',
      accountNumber: '1234567890',
      amount: '20000',
      bankName: 'Paystack-Titan',
      intentId: 'intent-1',
      orderId: 'order-1',
    });

    expect(parsed.orderNumber).toBeUndefined();
    expect(parsed.trackingToken).toBeUndefined();
    expect(parsed.merchantId).toBeUndefined();
    expect(parsed.merchantSlug).toBeUndefined();
    expect(parsed.walletFunded).toBeUndefined();

    expect(
      WalletFundedBankTransferParamsSchema.safeParse({
        ...validWalletFundedParams,
        merchantId: undefined,
        merchantSlug: undefined,
        orderNumber: undefined,
        trackingToken: undefined,
        walletFunded: undefined,
      }).success
    ).toBe(true);
  });

  it('retains optional values and matches inferred schema types', () => {
    const legacy: BankTransferParams =
      BankTransferParamsSchema.parse(validLegacyParams);
    const walletFunded: WalletFundedBankTransferParams =
      WalletFundedBankTransferParamsSchema.parse({
        ...validWalletFundedParams,
        merchantId: 'merchant-1',
        orderNumber: 'BAC-1',
        trackingToken: 'token',
      });

    expect(legacy.reference).toBe('ref-1');
    expect(walletFunded).toMatchObject({
      merchantId: 'merchant-1',
      orderNumber: 'BAC-1',
      trackingToken: 'token',
      walletFunded: 'true',
    });
  });

  it('rejects non-string required params instead of coercing them', () => {
    const result = BankTransferParamsSchema.safeParse({
      ...validLegacyParams,
      amount: 20000,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('invalid_type');
    }
  });
});
