import type { DomainEventV1 } from '@baci/shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createEventPipelineServiceRoleTestClient } from './event-pipeline-service-role-test-client';
import { loadPaidOrderDeliveryEvent } from './paid-order-delivery-event';

const event: DomainEventV1 = {
  data: { order_id: 'order-1' },
  domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
  event_name: 'analytics.purchase.completed.v1',
  external_event_id: 'browser-event-1',
  idempotency_key: 'paid-order-ad-tracking:order-1',
  merchant_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
  metadata: { environment: 'test' },
  occurred_at: '2026-07-12T12:00:00.000Z',
  producer: 'worker',
  schema_version: 1,
  source: {},
  subject: { id: 'order-1', type: 'order' },
  trust_level: 'server',
};

function client(data: unknown, error: { message: string } | null = null) {
  return createEventPipelineServiceRoleTestClient(
    vi.fn<typeof globalThis.fetch>(async () =>
      error ? Response.json(error, { status: 500 }) : Response.json(data)
    )
  );
}

describe('loadPaidOrderDeliveryEvent', () => {
  it('resolves customer data only at delivery time and preserves event identity', async () => {
    const result = await loadPaidOrderDeliveryEvent(
      client({
        ad_tracking: {
          fbc: 'fb.1.123.click',
          gaClientId: '123.456',
          limitedDataUse: true,
          analyticsConsent: true,
          ttclid: 'tt-click-1',
        },
        currency: 'NGN',
        customer_email: 'person@example.com',
        customer_id: 'customer-1',
        customer_name: 'Ada Lovelace',
        customer_phone: '+2348000000000',
        id: 'order-1',
        order_items: [
          { name: 'Phone', price: 100, product_id: 'sku-1', quantity: 1 },
        ],
        order_number: 'BAC-1',
        payment_status: 'paid',
        shipping_address: {
          city: 'Lagos',
          country: 'NG',
          postal_code: '100001',
          state: 'Lagos',
        },
        total: 100,
      }),
      event
    );

    expect(result.conversion).toMatchObject({
      event_id: 'browser-event-1',
      limited_data_use: true,
      merchant_id: event.merchant_id,
      occurred_at: event.occurred_at,
      user_data: {
        analytics_consent: true,
        email: 'person@example.com',
        city: 'Lagos',
        country: 'NG',
        fbc: 'fb.1.123.click',
        first_name: 'Ada',
        last_name: 'Lovelace',
        state: 'Lagos',
        ttclid: 'tt-click-1',
        zip_code: '100001',
      },
    });
    expect(result.gaClientId).toBe('123.456');
  });

  it('refuses delivery when the source order is not paid', async () => {
    await expect(
      loadPaidOrderDeliveryEvent(
        client({
          id: 'order-1',
          payment_status: 'unpaid',
          total: 100,
        }),
        event
      )
    ).rejects.toThrow('paid_order_not_deliverable');
  });

  it('rejects when the source order query fails', async () => {
    await expect(
      loadPaidOrderDeliveryEvent(
        client(null, { message: 'query failed' }),
        event
      )
    ).rejects.toThrow('paid_order_lookup_failed');
  });
});
