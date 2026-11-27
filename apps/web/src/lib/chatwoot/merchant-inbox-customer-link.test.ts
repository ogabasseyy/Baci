import { describe, expect, it } from 'vitest';
import { readCustomerLinkToken } from './merchant-inbox-customer-link';

const row = (attributes: unknown) => ({ custom_attributes: attributes });

describe('readCustomerLinkToken', () => {
  it('bugfix: ignores a note on the contact, which a merge can hand to a stranger', () => {
    const merged = {
      meta: {
        sender: { custom_attributes: { baci_customer_link: 'a.b.c' } },
      },
      custom_attributes: {},
    };

    expect(readCustomerLinkToken(merged)).toBeNull();
  });

  it('reads the signed link from the conversation attributes', () => {
    expect(readCustomerLinkToken(row({ baci_customer_link: 'a.b.c' }))).toBe(
      'a.b.c'
    );
  });

  it.each([
    ['no attributes', row(undefined)],
    ['an empty value', row({ baci_customer_link: '' })],
    ['a non-text value', row({ baci_customer_link: { x: 1 } })],
    ['another attribute', row({ plan: 'pro' })],
    ['no conversation attributes', { meta: {} }],
    ['not an object', 'text'],
    ['null', null],
  ])('returns null for %s', (_name, value) => {
    expect(readCustomerLinkToken(value)).toBeNull();
  });
});
