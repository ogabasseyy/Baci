import { describe, expect, it } from 'vitest';
import { MerchantInboxCustomerUnavailableError } from './merchant-inbox-customer-unavailable';

describe('MerchantInboxCustomerUnavailableError', () => {
  it('is an Error callers can tell apart from "no customer" by its class', () => {
    const error = new MerchantInboxCustomerUnavailableError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MerchantInboxCustomerUnavailableError);
  });

  it('carries a plain message with no customer or order detail', () => {
    const error = new MerchantInboxCustomerUnavailableError();

    expect(error.message).toBe('Customer records are temporarily unavailable');
  });

  it('keeps its own name so logs and handlers can recognise it', () => {
    expect(new MerchantInboxCustomerUnavailableError().name).toBe(
      'MerchantInboxCustomerUnavailableError'
    );
  });
});
