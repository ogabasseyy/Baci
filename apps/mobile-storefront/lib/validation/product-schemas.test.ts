import {
  CustomerRowSchema,
  isCustomerRealtimePayload,
  isOrderRealtimePayload,
  isWalletRealtimePayload,
  OrderRowSchema,
  parseApiResponse,
  WalletRowSchema,
} from './product-schemas';

const validOrder = {
  id: '4bfca2e0-5d93-4cdf-b9fc-0b0fd3753e0f',
  order_number: 'ORD-1001',
  total: 50000,
  payment_status: 'paid',
  shipping_status: 'pending',
  tracking_number: null,
  shipping_provider: null,
  created_at: '2026-03-17T00:00:00Z',
  updated_at: '2026-03-17T00:00:00Z',
};

const validWallet = {
  id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
  available_balance: 120000,
};

const validCustomer = {
  id: '5ceef4f0-3a3c-4e76-b983-d5f1f8328576',
  email: 'customer@example.com',
  first_name: 'Ada',
  last_name: 'Ayo',
  phone: '08012345678',
  loyalty_points: 150,
};

describe('isOrderRealtimePayload', () => {
  it('accepts valid new record with null old record', () => {
    expect(isOrderRealtimePayload({ new: validOrder, old: null })).toBe(true);
  });

  it('rejects invalid new record', () => {
    expect(isOrderRealtimePayload({ new: { id: 'not-uuid' }, old: null })).toBe(
      false
    );
  });

  it('accepts valid old record when present', () => {
    expect(isOrderRealtimePayload({ new: validOrder, old: validOrder })).toBe(
      true
    );
  });

  it('rejects invalid old record when present', () => {
    expect(
      isOrderRealtimePayload({ new: validOrder, old: { id: 'invalid' } })
    ).toBe(false);
  });

  it('accepts payload with missing old record', () => {
    expect(isOrderRealtimePayload({ new: validOrder })).toBe(true);
  });
});

describe('isWalletRealtimePayload', () => {
  it('accepts valid new record with null old record', () => {
    expect(isWalletRealtimePayload({ new: validWallet, old: null })).toBe(true);
  });

  it('rejects invalid new record', () => {
    expect(
      isWalletRealtimePayload({
        new: { id: 'not-uuid', available_balance: 2 },
        old: null,
      })
    ).toBe(false);
  });

  it('accepts valid old record when present', () => {
    expect(
      isWalletRealtimePayload({ new: validWallet, old: validWallet })
    ).toBe(true);
  });

  it('rejects invalid old record when present', () => {
    expect(
      isWalletRealtimePayload({
        new: validWallet,
        old: { id: validWallet.id, available_balance: 'bad' },
      })
    ).toBe(false);
  });

  it('accepts payload with missing old record', () => {
    expect(isWalletRealtimePayload({ new: validWallet })).toBe(true);
  });
});

describe('isCustomerRealtimePayload', () => {
  it('accepts valid new record with null old record', () => {
    expect(isCustomerRealtimePayload({ new: validCustomer, old: null })).toBe(
      true
    );
  });

  it('rejects invalid new record', () => {
    expect(
      isCustomerRealtimePayload({
        new: { id: validCustomer.id, email: 'bad' },
        old: null,
      })
    ).toBe(false);
  });

  it('accepts valid old record when present', () => {
    expect(
      isCustomerRealtimePayload({ new: validCustomer, old: validCustomer })
    ).toBe(true);
  });

  it('rejects invalid old record when present', () => {
    expect(
      isCustomerRealtimePayload({
        new: validCustomer,
        old: { ...validCustomer, email: 'not-email' },
      })
    ).toBe(false);
  });

  it('accepts payload with missing old record', () => {
    expect(isCustomerRealtimePayload({ new: validCustomer })).toBe(true);
  });
});

describe('parseApiResponse', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns parsed data for valid payload', () => {
    expect(parseApiResponse(OrderRowSchema, validOrder, 'order')).toEqual(
      validOrder
    );
    expect(parseApiResponse(WalletRowSchema, validWallet, 'wallet')).toEqual(
      validWallet
    );
    expect(
      parseApiResponse(CustomerRowSchema, validCustomer, 'customer')
    ).toEqual(validCustomer);
  });

  it('preserves the typed username cooldown timestamp on customer rows', () => {
    const usernameChangedAt = '2026-08-04T12:00:00.000Z';

    expect(
      CustomerRowSchema.parse({
        ...validCustomer,
        username: 'ogafan',
        username_changed_at: usernameChangedAt,
      }).username_changed_at
    ).toBe(usernameChangedAt);
  });

  it('returns null and logs warning for invalid payload', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidOrder = { ...validOrder, id: 'invalid-id' };

    expect(parseApiResponse(OrderRowSchema, invalidOrder, 'order')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'API response validation failed',
      '(order)',
      expect.arrayContaining([expect.stringContaining('"path":["id"]')])
    );
  });
});

test('retains the customer merchant binding used by Oxygen staging admission', () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  expect(
    CustomerRowSchema.parse({ ...validCustomer, merchant_id: merchantId })
  ).toHaveProperty('merchant_id', merchantId);
});
