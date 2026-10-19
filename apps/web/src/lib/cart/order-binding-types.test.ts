import { describe, expect, it } from 'vitest';
import { ORDER_BINDING_RPC_NAMES } from './order-binding';
import { ORDER_BINDING_VARIANTS } from './order-binding-types';

describe('order binding variants', () => {
  it('pins the reviewed variant vocabulary', () => {
    expect(ORDER_BINDING_VARIANTS).toEqual([
      'base',
      'savings',
      'quiz_voucher',
      'discount_code',
      'loyalty_code',
    ]);
  });

  it('dispatches every variant to a named inner order RPC', () => {
    expect(Object.keys(ORDER_BINDING_RPC_NAMES).sort()).toEqual(
      [...ORDER_BINDING_VARIANTS].sort()
    );
    for (const rpc of Object.values(ORDER_BINDING_RPC_NAMES)) {
      expect(rpc).toMatch(/^create_storefront_order/);
    }
  });
});
