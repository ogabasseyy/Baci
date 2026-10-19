import { describe, expect, it } from 'vitest';
import { adminAuditTimelineSchema } from './admin-audit-rpc';

const validAuditEvent = {
  action: 'a'.repeat(100),
  actor_kind: 'Platform admin',
  changed_fields: ['f'.repeat(64)],
  event_id: '123e4567-e89b-42d3-a456-426614174000',
  event_source: 'canonical',
  occurred_at: '2026-08-05T14:00:00+01:00',
  resource_type: 'r'.repeat(80),
} as const;

describe('adminAuditTimelineSchema', () => {
  it('accepts bounded audit events at their documented limits', () => {
    expect(adminAuditTimelineSchema.parse([validAuditEvent])).toEqual([
      validAuditEvent,
    ]);
  });

  it.each([
    { action: '' },
    { actor_kind: 'Merchant' },
    { changed_fields: ['x'.repeat(65)] },
    { event_id: 'not-a-uuid' },
    { event_source: 'legacy' },
    { occurred_at: '2026-08-05T14:00:00' },
    { resource_type: 'r'.repeat(81) },
  ])('rejects malformed timeline fields: %o', (override) => {
    expect(
      adminAuditTimelineSchema.safeParse([{ ...validAuditEvent, ...override }])
        .success
    ).toBe(false);
  });
});
