import { describe, expect, it, vi } from 'vitest';
import { createEventPipelineTestClient } from './event-pipeline-test-client';
import { recordAnalyticsDomainEvent } from './record-analytics-domain-event';

function client(
  rpc: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
) {
  return createEventPipelineTestClient(
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const result = await rpc(
        new URL(String(input)).pathname.split('/').at(-1),
        JSON.parse(String(init?.body ?? '{}'))
      );
      return result.error
        ? Response.json(result.error, { status: 500 })
        : Response.json(result.data);
    })
  );
}

describe('recordAnalyticsDomainEvent', () => {
  it('redacts the queue payload while preserving the analytics row payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          already_enqueued: false,
          domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
          queue_message_id: 42,
        },
      ],
      error: null,
    });

    await recordAnalyticsDomainEvent(client(rpc), {
      eventData: { product_id: 'p1', user_agent: 'secret-agent' },
      eventName: 'analytics.product_view.v1',
      eventTimestamp: '2026-07-12T12:00:00.000Z',
      eventType: 'product_view',
      externalEventId: 'event-1',
      merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
      source: 'web',
      trustLevel: 'tenant_verified_client',
    });

    expect(rpc).toHaveBeenCalledWith(
      'record_analytics_domain_event_v1',
      expect.objectContaining({
        p_domain_event_data: { product_id: 'p1' },
        p_event_data: { product_id: 'p1', user_agent: 'secret-agent' },
      })
    );
  });

  it('fails closed when the RPC result is malformed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await expect(
      recordAnalyticsDomainEvent(client(rpc), {
        eventData: {},
        eventName: 'analytics.page_view.v1',
        eventTimestamp: '2026-07-12T12:00:00.000Z',
        eventType: 'page_view',
        externalEventId: 'event-1',
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        source: 'web',
        trustLevel: 'tenant_verified_client',
      })
    ).rejects.toThrow('durable_analytics_enqueue_invalid');
  });

  it('rejects cyclic event data before invoking the durable RPC', async () => {
    const rpc = vi.fn();
    const eventData: Record<string, unknown> = {};
    eventData.self = eventData;
    await expect(
      recordAnalyticsDomainEvent(client(rpc), {
        eventData,
        eventName: 'analytics.page_view.v1',
        eventTimestamp: '2026-07-12T12:00:00.000Z',
        eventType: 'page_view',
        externalEventId: 'event-1',
        merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
        source: 'web',
        trustLevel: 'tenant_verified_client',
      })
    ).rejects.toThrow('event_pipeline_non_json_value');
    expect(rpc).not.toHaveBeenCalled();
  });
});

it('preserves explicit empty provider targets through both durable and internal observation payloads', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        already_enqueued: false,
        domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
        queue_message_id: 42,
      },
    ],
    error: null,
  });
  await recordAnalyticsDomainEvent(client(rpc), {
    eventData: { product_id: 'one', targets: [] },
    eventName: 'analytics.product_view.v1',
    eventTimestamp: '2026-07-12T12:00:00.000Z',
    eventType: 'product_view',
    externalEventId: 'one',
    merchantId: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a235',
    source: 'web',
    trustLevel: 'tenant_verified_client',
  });
  expect(rpc).toHaveBeenCalledWith(
    'record_analytics_domain_event_v1',
    expect.objectContaining({
      p_event_data: { product_id: 'one', targets: [] },
      p_domain_event_data: { product_id: 'one', targets: [] },
    })
  );
});
