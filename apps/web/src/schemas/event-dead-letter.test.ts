import { describe, expect, it } from 'vitest';
import {
  eventDeadLetterQuerySchema,
  eventDeadLetterReplaySchema,
  eventPipelineDeliveryListSchema,
  eventPipelineIngressListSchema,
  eventPipelineOperationsSchema,
  eventPipelineReplayIdsSchema,
} from './event-dead-letter';

const ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234';

describe('event dead-letter schema facade', () => {
  it('preserves every public schema export', () => {
    expect(eventDeadLetterQuerySchema.parse({})).toMatchObject({
      kind: 'all',
      limit: 50,
      offset: 0,
    });
    expect(
      eventDeadLetterReplaySchema.safeParse({
        failure_id: ID,
        kind: 'ingress',
        reason: 'Producer repair verified',
      }).success
    ).toBe(true);
    expect(
      eventPipelineIngressListSchema.safeParse({ count: 0, items: [] }).success
    ).toBe(true);
    expect(
      eventPipelineDeliveryListSchema.safeParse({ count: 0, items: [] }).success
    ).toBe(true);
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [],
        heartbeats: [],
        queue: null,
      }).success
    ).toBe(true);
    expect(eventPipelineReplayIdsSchema.safeParse([ID]).success).toBe(true);
    expect(eventPipelineReplayIdsSchema.safeParse(['invalid']).success).toBe(
      false
    );
  });
});
