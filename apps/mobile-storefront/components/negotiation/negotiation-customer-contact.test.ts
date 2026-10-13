import { buildNegotiationCustomerContact } from './negotiation-customer-contact';

describe('buildNegotiationCustomerContact', () => {
  it('requires a phone for guests', () => {
    expect(buildNegotiationCustomerContact(null, '')).toMatchObject({
      errorMessage:
        'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.',
      normalizedPhone: null,
      userId: null,
    });
  });

  it('uses the account email when a signed-in customer leaves phone empty', () => {
    const customer = {
      email: ' Buyer@Example.COM ',
      id: 'customer-1',
      phone: null,
    };

    const result = buildNegotiationCustomerContact(customer, '');

    expect(result).toEqual({
      errorMessage: null,
      normalizedEmail: 'buyer@example.com',
      normalizedPhone: null,
      userId: 'customer-1',
    });
  });

  it('uses the account phone when a signed-in customer leaves phone empty', () => {
    const customer = {
      email: null,
      id: 'customer-1',
      phone: '15551234567',
    };

    const result = buildNegotiationCustomerContact(customer, '');

    expect(result).toEqual({
      errorMessage: null,
      normalizedEmail: null,
      normalizedPhone: '15551234567',
      userId: 'customer-1',
    });
  });

  it('does not apply the Nigerian dial code to a non-Nigerian account phone', () => {
    const result = buildNegotiationCustomerContact(
      { email: null, id: 'customer-1', phone: '+442012345678' },
      ''
    );

    expect(result.normalizedPhone).toBe('442012345678');
  });

  it('requires direct contact when a signed-in account has no email or phone', () => {
    const customer = { email: null, id: 'customer-1', phone: null };

    const result = buildNegotiationCustomerContact(customer, '');

    expect(result).toEqual({
      errorMessage:
        'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.',
      normalizedEmail: null,
      normalizedPhone: null,
      userId: 'customer-1',
    });
  });

  it('allows guests with a normalized phone', () => {
    expect(
      buildNegotiationCustomerContact(null, '2348031234567')
    ).toMatchObject({
      errorMessage: null,
      normalizedPhone: '2348031234567',
      userId: null,
    });
  });

  it('normalizes a valid phone for a guest', () => {
    expect(buildNegotiationCustomerContact(null, '0803 123 4567')).toEqual({
      errorMessage: null,
      normalizedEmail: null,
      normalizedPhone: '2348031234567',
      userId: null,
    });
  });

  it('returns the validation message before a guest upload', () => {
    expect(buildNegotiationCustomerContact(null, '')).toMatchObject({
      errorMessage:
        'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.',
      normalizedPhone: null,
    });
  });

  it('rejects a nonblank invalid phone', () => {
    expect(buildNegotiationCustomerContact(null, 'not a phone')).toEqual({
      errorMessage: 'Enter a valid Phone / WhatsApp number.',
      normalizedEmail: null,
      normalizedPhone: null,
      userId: null,
    });
  });
});
