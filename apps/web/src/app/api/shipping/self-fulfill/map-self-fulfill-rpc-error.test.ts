import { describe, expect, it } from 'vitest';
import { mapSelfFulfillRpcError } from './map-self-fulfill-rpc-error';

describe('mapSelfFulfillRpcError', () => {
  it('maps active booking locks to 409', () => {
    expect(
      mapSelfFulfillRpcError({
        code: '55P03',
        message: 'active_shipment_booking_lock',
      })
    ).toEqual({
      status: 409,
      error: 'Order has an active shipping booking',
      code: 'ACTIVE_SHIPPING_BOOKING',
    });
  });

  it('bugfix: maps settled retention self-fulfill rejection to 409 instead of 500', () => {
    expect(
      mapSelfFulfillRpcError({
        code: 'P0001',
        message: 'settled_checkout_retention_blocks_self_fulfillment',
      })
    ).toEqual({
      status: 409,
      error:
        'Shipping retention has already settled for this order, so self-fulfillment is unavailable.',
      code: 'SETTLED_CHECKOUT_RETENTION_BLOCKS_SELF_FULFILLMENT',
    });
  });

  it('maps already-shipped P0001 to 400', () => {
    expect(
      mapSelfFulfillRpcError({
        code: 'P0001',
        message: 'order_already_shipped',
      })
    ).toEqual({
      status: 400,
      error: 'Order has already been shipped',
      code: 'ORDER_ALREADY_SHIPPED',
    });
  });

  it('maps order_not_owned permission denials to 403', () => {
    expect(
      mapSelfFulfillRpcError({
        code: '42501',
        message: 'order_not_owned',
      })
    ).toEqual({
      status: 403,
      error: 'You do not have permission to self-fulfill this order',
      code: 'ORDER_NOT_OWNED',
    });
  });

  it('fails closed to 500 for unexpected rpc errors', () => {
    expect(
      mapSelfFulfillRpcError({
        code: 'XX000',
        message: 'unexpected',
      })
    ).toEqual({
      status: 500,
      error: 'Failed to update order',
    });
  });
});
