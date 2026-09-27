import { describe, expectTypeOf, it } from 'vitest';
import type {
  ImmediateNotificationOrder,
  ImmediateOrderNotificationContext,
  MerchantOrderNotificationContext,
  ResolvedImmediateOrderEmail,
} from './notification-context';

describe('notification-context shapes', () => {
  it('keeps the order row indexable for RPC extras', () => {
    expectTypeOf<ImmediateNotificationOrder>().toMatchTypeOf<{
      id: string;
    }>();
    expectTypeOf<ImmediateNotificationOrder>().toMatchTypeOf<
      Record<string, unknown>
    >();
  });

  it('requires the merchant handoff fields', () => {
    expectTypeOf<MerchantOrderNotificationContext>().toMatchTypeOf<{
      merchantId: string;
      orderId: string;
      orderNumber: string;
      orderTotal: number;
      orderCurrency: string;
    }>();
  });

  it('pins the email document kinds', () => {
    expectTypeOf<ResolvedImmediateOrderEmail['documentKind']>().toEqualTypeOf<
      'confirmation' | 'proforma' | 'payment_request'
    >();
    expectTypeOf<ImmediateOrderNotificationContext>().toMatchTypeOf<{
      order: ImmediateNotificationOrder;
      customerEmail: string;
    }>();
  });
});
