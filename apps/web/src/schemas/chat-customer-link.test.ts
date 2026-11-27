import { describe, expect, it } from 'vitest';
import {
  CHAT_CUSTOMER_LINK_ATTRIBUTE,
  chatCustomerLinkRequestSchema,
} from './chat-customer-link';

describe('chatCustomerLinkRequestSchema', () => {
  it('accepts a store slug and trims it', () => {
    expect(
      chatCustomerLinkRequestSchema.parse({ storeSlug: '  ogabassey ' })
    ).toEqual({ storeSlug: 'ogabassey' });
  });

  it('accepts a slug of exactly 120 characters and refuses 121', () => {
    expect(
      chatCustomerLinkRequestSchema.safeParse({ storeSlug: 'a'.repeat(120) })
        .success
    ).toBe(true);
    expect(
      chatCustomerLinkRequestSchema.safeParse({ storeSlug: 'a'.repeat(121) })
        .success
    ).toBe(false);
  });

  it.each([
    ['a missing slug', {}],
    ['an empty slug', { storeSlug: '' }],
    ['a blank slug', { storeSlug: '   ' }],
    ['a non-text slug', { storeSlug: 7 }],
    ['an extra key such as a customer id', { storeSlug: 'a', customerId: 'x' }],
  ])('rejects %s', (_name, body) => {
    expect(chatCustomerLinkRequestSchema.safeParse(body).success).toBe(false);
  });

  it('keeps the contact attribute name the inbox reads', () => {
    expect(CHAT_CUSTOMER_LINK_ATTRIBUTE).toBe('baci_customer_link');
  });
});
