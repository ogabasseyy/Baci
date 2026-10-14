import { describe, expect, it } from 'vitest';
import {
  getLiveCustomerIdentity,
  publishCustomerIdentity,
} from './customer-live-identity';

describe('customer-live-identity', () => {
  it('publishes the current identity synchronously for settlement checks', () => {
    publishCustomerIdentity({ id: 'user-1' }, { id: 'customer-1' });
    expect(getLiveCustomerIdentity()).toEqual({
      customerId: 'customer-1',
      userId: 'user-1',
    });

    publishCustomerIdentity(null, null);
    expect(getLiveCustomerIdentity()).toEqual({
      customerId: null,
      userId: null,
    });
  });
});
