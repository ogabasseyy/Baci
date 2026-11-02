import { vi } from 'vitest';

export function createOrderSecurityRpcMock() {
  return vi.fn(
    (
      name: string,
      _args?: unknown
    ): Promise<{ data: unknown; error: unknown }> => {
      if (name === 'get_storefront_payment_settings') {
        return Promise.resolve({
          data: [{ pay_on_delivery_enabled: true }],
          error: null,
        });
      }
      // B3.5 round 7: helper's variant lookup routes through this
      // SDF on the same scoped client.
      if (name === 'get_order_variant_overrides') {
        return Promise.resolve({ data: [], error: null });
      }
      // Immediate-notification delivery is gated on the proof-bound
      // claim (tracking token verified inside the RPC): the winner
      // delivers, completions record terminal state.
      if (name === 'claim_immediate_order_notification_with_proof') {
        return Promise.resolve({
          data: [{ claimed: true, claim_token: 'lease-sec-1' }],
          error: null,
        });
      }
      if (name === 'mark_immediate_order_notification_started_with_proof') {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'complete_immediate_order_notification_with_proof') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: [
          {
            id: 'order-id',
            order_number: 'ORD-123',
            total: 1000,
            subtotal: 1000,
            shipping_fee: 0,
            customer_id: 'customer-id',
            // Production orders always carry a tracking token (NOT NULL
            // default): the proof-bound claim needs it to authorize.
            tracking_token: 'tok-order-1',
          },
        ],
        error: null,
      });
    }
  );
}
