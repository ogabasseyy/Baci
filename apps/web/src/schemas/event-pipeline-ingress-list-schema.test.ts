import { describe, expect, it } from 'vitest';
import { eventPipelineIngressListSchema } from './event-pipeline-ingress-list-schema';

describe('eventPipelineIngressListSchema', () => {
  it('rejects raw failure messages from the admin DTO', () => {
    expect(
      eventPipelineIngressListSchema.safeParse({
        count: 1,
        items: [
          {
            event_name: 'order.paid',
            failure_code: 'invalid_payload',
            failure_message: 'customer@example.com was rejected',
            first_failed_at: '2026-08-05T10:00:00.000Z',
            id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
            last_failed_at: '2026-08-05T10:01:00.000Z',
            replay_count: 0,
          },
        ],
      }).success
    ).toBe(false);
  });
});
