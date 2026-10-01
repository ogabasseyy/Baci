import type { AdminAuditEvent } from '@/lib/admin-audit';

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function escapeCsvCell(value: string): string {
  const safeValue = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

/** Converts the safe projection only; raw audit snapshots never reach CSV. */
export function createAdminAuditCsv(events: AdminAuditEvent[]): string {
  const rows = events.map((event) =>
    [
      event.occurredAt,
      event.eventSource,
      event.actorKind,
      event.action,
      event.resourceType,
      event.changedFields.join(', '),
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [
    'occurred_at,event_source,actor_kind,action,resource_type,changed_fields',
    ...rows,
  ].join('\r\n');
}
