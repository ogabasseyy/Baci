import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAuditQuery } from '@/schemas/admin-audit-query';
import { adminAuditTimelineSchema } from '@/schemas/admin-audit-rpc';
import type { Database } from '@/types/supabase';

export interface AdminAuditEvent {
  action: string;
  actorKind: 'Platform admin' | 'Service' | 'System' | 'User';
  changedFields: string[];
  eventId: string;
  eventSource: 'canonical' | 'platform';
  occurredAt: string;
  resourceType: string;
}

export interface AdminAuditTimeline {
  events: AdminAuditEvent[];
  nextCursor: {
    id: string;
    occurredAt: string;
    source: 'canonical' | 'platform';
  } | null;
}

interface PlatformAuditReadResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

type PlatformAuditReader = (args: {
  p_action: string | null;
  p_before_event_id: string | null;
  p_before_event_source: 'canonical' | 'platform' | null;
  p_before_occurred_at: string | null;
  p_limit: number;
  p_resource_type: string | null;
  p_source: 'canonical' | 'platform' | null;
}) => Promise<PlatformAuditReadResult>;

export async function listAdminAuditEvents(
  supabase: SupabaseClient<Database>,
  query: AdminAuditQuery
): Promise<{
  data: AdminAuditTimeline | null;
  error: { code?: string; message: string } | null;
}> {
  // Generated Database typings must include list_platform_audit_events_v1 once
  // the migration is applied. Localize the temporary typed RPC bridge here.
  const read = supabase.rpc as unknown as (
    functionName: 'list_platform_audit_events_v1',
    args: Parameters<PlatformAuditReader>[0]
  ) => ReturnType<PlatformAuditReader>;

  const { data, error } = await read('list_platform_audit_events_v1', {
    p_action: query.action ?? null,
    p_before_event_id: query.beforeId ?? null,
    p_before_event_source: query.beforeSource ?? null,
    p_before_occurred_at: query.beforeOccurredAt ?? null,
    p_limit: query.limit + 1,
    p_resource_type: query.resourceType ?? null,
    p_source: query.source === 'all' ? null : query.source,
  });

  if (error) {
    return { data: null, error };
  }

  const parsed = adminAuditTimelineSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_AUDIT_TIMELINE',
        message: 'Platform audit timeline returned an invalid payload',
      },
    };
  }

  const hasMore = parsed.data.length > query.limit;
  const events = parsed.data.slice(0, query.limit).map((event) => ({
    action: event.action,
    actorKind: event.actor_kind,
    changedFields: event.changed_fields,
    eventId: event.event_id,
    eventSource: event.event_source,
    occurredAt: event.occurred_at,
    resourceType: event.resource_type,
  }));
  const lastEvent = events.at(-1);

  return {
    data: {
      events,
      nextCursor:
        hasMore && lastEvent
          ? {
              id: lastEvent.eventId,
              occurredAt: lastEvent.occurredAt,
              source: lastEvent.eventSource,
            }
          : null,
    },
    error: null,
  };
}
