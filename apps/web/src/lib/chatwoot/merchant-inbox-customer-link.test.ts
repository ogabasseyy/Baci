import { describe, expect, it } from 'vitest';
import { readCustomerLinkToken } from './merchant-inbox-customer-link';

const row = (attributes: unknown) => ({
  meta: { sender: { custom_attributes: attributes } },
});

describe('readCustomerLinkToken', () => {
  it('reads the signed link from the contact attributes', () => {
    expect(readCustomerLinkToken(row({ baci_customer_link: 'a.b.c' }))).toBe(
      'a.b.c'
    );
  });

  it.each([
    ['no attributes', row(undefined)],
    ['an empty value', row({ baci_customer_link: '' })],
    ['a non-text value', row({ baci_customer_link: { x: 1 } })],
    ['another attribute', row({ plan: 'pro' })],
    ['no sender', { meta: {} }],
    ['not an object', 'text'],
    ['null', null],
  ])('returns null for %s', (_name, value) => {
    expect(readCustomerLinkToken(value)).toBeNull();
  });
});
