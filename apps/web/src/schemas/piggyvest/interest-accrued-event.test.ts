import { describe, expect, it } from 'vitest';
import { interestAccruedSuccessEventSchema } from './interest-accrued-event';

const providerEvent = {
  eventId: '30000000-0000-4000-8000-000000000001',
  customer_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  eventData: {
    id: '30000000-0000-4000-8000-000000000002',
    wallet_id: '30000000-0000-4000-8000-000000000003',
    balance: 1650000,
    percentage: 9,
    interest_date: '2026-09-28T00:00:00.000Z',
    amount: 406.8493150684931,
    interest_type: 'original',
  },
  pvb_wallet: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  pvb_wallet_name: 'Synthetic interest wallet',
  pvb_split_interest_with_wallet: null,
  pvb_split_interest_with_wallet_name: null,
};

function expectInvalid(changes: Record<string, unknown>) {
  expect(
    interestAccruedSuccessEventSchema.safeParse({
      ...providerEvent,
      ...changes,
    }).success
  ).toBe(false);
}

describe('interestAccruedSuccessEventSchema', () => {
  it('preserves the provider fractional-kobo sample exactly', () => {
    const result = interestAccruedSuccessEventSchema.parse(providerEvent);

    expect(result).toEqual(providerEvent);
    expect(result.eventData.amount).toBe(406.8493150684931);
    expect(result.eventData.wallet_id).not.toBe(result.pvb_wallet);
  });

  it('accepts differential accrual without inferring a split wallet', () => {
    const event = {
      ...providerEvent,
      eventData: { ...providerEvent.eventData, interest_type: 'differential' },
    };

    expect(interestAccruedSuccessEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    'original',
    'differential',
  ])('preserves an explicit public split destination for %s without deriving a credit', (interestType) => {
    const event = {
      ...providerEvent,
      eventData: { ...providerEvent.eventData, interest_type: interestType },
      pvb_split_interest_with_wallet: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      pvb_split_interest_with_wallet_name: 'Split wallet',
    };

    expect(interestAccruedSuccessEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    'malformed',
    providerEvent.eventData.wallet_id,
    'i'.repeat(513),
    123,
  ])('rejects a non-ULID split destination: %s', (wallet) => {
    expectInvalid({
      pvb_split_interest_with_wallet: wallet,
      pvb_split_interest_with_wallet_name: 'Split wallet',
    });
  });

  it.each([
    'n'.repeat(513),
    123,
    undefined,
  ])('rejects an invalid split wallet name: %s', (name) => {
    expectInvalid({
      pvb_split_interest_with_wallet: providerEvent.pvb_wallet,
      pvb_split_interest_with_wallet_name: name,
    });
  });

  it.each([
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '30000000-0000-4000-8000-000000000004',
  ])('accepts a provider customer ULID or UUID: %s', (customerId) => {
    const event = { ...providerEvent, customer_id: customerId };

    expect(interestAccruedSuccessEventSchema.parse(event).customer_id).toBe(
      customerId
    );
  });

  it.each([
    0,
    0.5,
    Number.MAX_SAFE_INTEGER,
  ])('preserves nonnegative fractional or bounded kobo: %s', (amount) => {
    const event = {
      ...providerEvent,
      eventData: { ...providerEvent.eventData, amount, balance: amount },
    };

    expect(interestAccruedSuccessEventSchema.parse(event)).toEqual(event);
  });

  it.each([0, 9.5, 100])('accepts percentage boundary %s', (percentage) => {
    const event = {
      ...providerEvent,
      eventData: { ...providerEvent.eventData, percentage },
    };

    expect(interestAccruedSuccessEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    'event:interest_accrued-2026.09.28',
    'e'.repeat(128),
  ])('preserves a stable bounded event ID: %s', (eventId) => {
    const event = { ...providerEvent, eventId };

    expect(interestAccruedSuccessEventSchema.parse(event).eventId).toBe(
      eventId
    );
  });

  it('accepts an opaque data ID within the existing provider-ID byte bound', () => {
    const event = {
      ...providerEvent,
      eventData: { ...providerEvent.eventData, id: 'i'.repeat(512) },
    };

    expect(interestAccruedSuccessEventSchema.parse(event)).toEqual(event);
  });

  describe.each(['amount', 'balance'] as const)('%s validation', (field) => {
    it.each([
      -1,
      -0.001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '406.8493150684931',
      null,
      false,
      undefined,
    ])('rejects invalid kobo without coercion: %s', (value) => {
      expectInvalid({
        eventData: { ...providerEvent.eventData, [field]: value },
      });
    });
  });

  it.each([
    -0.01,
    100.001,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '9',
    null,
    false,
    undefined,
  ])('rejects invalid percentage: %s', (percentage) => {
    expectInvalid({
      eventData: { ...providerEvent.eventData, percentage },
    });
  });

  it.each([
    '',
    'e'.repeat(129),
    'event with spaces',
    'event/id',
    'event\0id',
    '\ud800',
    'é',
    123,
    null,
  ])('rejects malformed event IDs: %s', (eventId) => {
    expectInvalid({ eventId });
  });

  describe.each([
    'customer_id',
    'pvb_wallet',
  ] as const)('%s validation', (field) => {
    it.each([
      '',
      'i'.repeat(513),
      'malformed',
      '\0',
      '\ud800',
      123,
      null,
    ])('rejects malformed or unbounded provider identity: %s', (value) => {
      expectInvalid({ [field]: value });
    });
  });

  it.each([
    '',
    'i'.repeat(513),
    'é'.repeat(257),
    '\0',
    '\ud800',
    123,
    null,
  ])('rejects invalid data IDs under the existing provider-ID contract: %s', (id) => {
    expectInvalid({ eventData: { ...providerEvent.eventData, id } });
  });

  it.each([
    '',
    providerEvent.pvb_wallet,
    'malformed',
    'i'.repeat(513),
    123,
    null,
  ])('requires an internal wallet UUID without accepting a public ULID: %s', (walletId) => {
    expectInvalid({
      eventData: { ...providerEvent.eventData, wallet_id: walletId },
    });
  });

  it('rejects an internal UUID in the public wallet field', () => {
    expectInvalid({ pvb_wallet: providerEvent.eventData.wallet_id });
  });

  it.each([
    '',
    '2026-09-28',
    '2026-09-28T00:00:00',
    '2026-09-28T00:00:00+01:00',
    '2026-02-30T00:00:00Z',
    '2026-09-28T25:00:00Z',
    'malformed',
    123,
    null,
  ])('rejects malformed or non-UTC interest dates: %s', (interestDate) => {
    expectInvalid({
      eventData: { ...providerEvent.eventData, interest_date: interestDate },
    });
  });

  it.each([
    { eventType: 'interest-payout.success' },
    { eventCategory: 'interest-payout' },
    { customer_id: undefined },
    { pvb_wallet_name: 123 },
    { pvb_wallet_name: 'n'.repeat(513) },
    { pvb_split_interest_with_wallet: providerEvent.pvb_wallet },
    { pvb_split_interest_with_wallet_name: 'Split wallet' },
    { pvb_split_interest_with_wallet: undefined },
    { pvb_split_interest_with_wallet_name: undefined },
    { eventData: null },
    { eventData: [] },
  ])('rejects malformed or unobserved envelope fields: %j', (changes) => {
    expectInvalid(changes);
  });

  it.each([
    'split',
    'payout',
    '',
    null,
    undefined,
  ])('rejects unsupported interest types: %s', (interestType) => {
    expectInvalid({
      eventData: { ...providerEvent.eventData, interest_type: interestType },
    });
  });

  it('rejects unobserved top-level and data contracts', () => {
    expectInvalid({ pvb_reference: 'unobserved-reference' });
    expectInvalid({
      eventData: { ...providerEvent.eventData, currency: 'NGN' },
    });
  });
});
