import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { listAdminAuditEvents } from './admin-audit';

const eventId = 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1';

function mockSupabase(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient<Database>;
}

describe('listAdminAuditEvents', () => {
  it('maps only the safe RPC projection without inventing a cursor', async () => {
    const supabase = mockSupabase([
      {
        action: 'audit.exported',
        actor_kind: 'Platform admin',
        changed_fields: ['filters'],
        event_id: eventId,
        event_source: 'platform',
        occurred_at: '2026-08-05T10:00:00.000Z',
        resource_type: 'audit_timeline',
      },
    ]);

    const result = await listAdminAuditEvents(supabase, {
      limit: 50,
      source: 'all',
    });

    expect(result.error).toBeNull();
    expect(result.data?.events[0]).toEqual({
      action: 'audit.exported',
      actorKind: 'Platform admin',
      changedFields: ['filters'],
      eventId,
      eventSource: 'platform',
      occurredAt: '2026-08-05T10:00:00.000Z',
      resourceType: 'audit_timeline',
    });
    expect(result.data?.nextCursor).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'list_platform_audit_events_v1',
      expect.objectContaining({ p_limit: 51 })
    );
  });

  it('uses the extra reader row only to expose a cursor for a real next page', async () => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      action: 'audit.exported',
      actor_kind: 'Platform admin',
      changed_fields: ['filters'],
      event_id: `d8543bf1-5f03-4fd1-8a2a-${String(index).padStart(12, '0')}`,
      event_source: 'platform',
      occurred_at: '2026-08-05T10:00:00.000Z',
      resource_type: 'audit_timeline',
    }));

    const result = await listAdminAuditEvents(mockSupabase(events), {
      limit: 50,
      source: 'all',
    });

    expect(result.data?.events).toHaveLength(50);
    expect(result.data?.nextCursor).toEqual({
      id: events[49].event_id,
      occurredAt: events[49].occurred_at,
      source: 'platform',
    });
  });

  it('rejects malformed reader output before it reaches the admin page', async () => {
    const result = await listAdminAuditEvents(mockSupabase([{ action: 'x' }]), {
      limit: 50,
      source: 'all',
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('INVALID_AUDIT_TIMELINE');
  });
});
