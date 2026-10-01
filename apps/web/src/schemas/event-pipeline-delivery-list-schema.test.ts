import { describe, expect, it } from 'vitest';
import { eventPipelineDeliveryListSchema } from './event-pipeline-delivery-list-schema';

describe('eventPipelineDeliveryListSchema', () => {
  it('rejects provider response identifiers from the admin DTO', () => {
    expect(
      eventPipelineDeliveryListSchema.safeParse({
        count: 1,
        items: [
          {
            attempts: 1,
            created_at: '2026-08-05T10:00:00.000Z',
            destination: 'ga4',
            event_name: 'order.paid',
            id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
            last_error_code: 'invalid_payload',
            provider_response_id: 'raw-provider-id',
            replay_count: 0,
            status: 'dead_letter',
            updated_at: '2026-08-05T10:01:00.000Z',
          },
        ],
      }).success
    ).toBe(false);
  });
});
