import { describe, expect, it } from 'vitest';
import { eventPipelineOperationsSchema } from './event-pipeline-operations-schema';

describe('eventPipelineOperationsSchema', () => {
  it('accepts safe admin RPC response envelopes', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [],
        heartbeats: [],
        queue: null,
      }).success
    ).toBe(true);
  });

  it('requires every response field', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({ deliveries: [], queue: null })
        .success
    ).toBe(false);
  });

  it('rejects raw worker identifiers', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [],
        heartbeats: [
          {
            last_error_at: '2026-08-05T10:00:00.000Z',
            last_error_code: null,
            last_started_at: '2026-08-05T10:00:00.000Z',
            last_succeeded_at: null,
            processed_count: 0,
            updated_at: '2026-08-05T10:00:00.000Z',
            worker_id: 'internal-worker-hostname',
            worker_name: 'event-delivery',
          },
        ],
        queue: null,
      }).success
    ).toBe(false);
  });

  it('rejects hostile worker error diagnostics', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [],
        heartbeats: [
          {
            last_error_at: '2026-08-05T10:00:00.000Z',
            last_error_code: 'recipient@example.com: request failed',
            last_started_at: '2026-08-05T10:00:00.000Z',
            last_succeeded_at: null,
            processed_count: 0,
            updated_at: '2026-08-05T10:00:00.000Z',
            worker_name: 'event-delivery',
          },
        ],
        queue: null,
      }).success
    ).toBe(false);
  });

  it('rejects negative delivery age values', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [
          {
            delivery_count: 0,
            destination: 'ga4',
            oldest_age_seconds: -1,
            status: 'pending',
          },
        ],
        heartbeats: [],
        queue: null,
      }).success
    ).toBe(false);
  });

  it('rejects negative queue age values', () => {
    expect(
      eventPipelineOperationsSchema.safeParse({
        deliveries: [],
        heartbeats: [],
        queue: {
          measured_at: '2026-08-05T10:00:00.000Z',
          newest_message_age_seconds: -1,
          oldest_message_age_seconds: 0,
          queue_length: 0,
          total_messages: 0,
        },
      }).success
    ).toBe(false);
  });
});
