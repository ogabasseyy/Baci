import type { AdminAuditTimeline } from '@/lib/admin-audit';

const PAGE_LIMIT = 50;

export interface AuditFilters {
  action: string;
  resourceType: string;
  source: 'all' | 'canonical' | 'platform';
}

export interface AuditApiResponse {
  data: AdminAuditTimeline;
  generatedAt: string;
}

export async function loadAuditEvents(
  filters: AuditFilters,
  cursor?: AdminAuditTimeline['nextCursor']
): Promise<AuditApiResponse> {
  const params = new URLSearchParams({
    limit: PAGE_LIMIT.toString(),
    source: filters.source,
  });
  if (filters.action) params.set('action', filters.action);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (cursor) {
    params.set('beforeOccurredAt', cursor.occurredAt);
    params.set('beforeSource', cursor.source);
    params.set('beforeId', cursor.id);
  }

  const response = await fetch(`/api/admin/audit-events?${params}`);
  if (!response.ok) throw new Error('Failed to load platform audit events');
  return (await response.json()) as AuditApiResponse;
}
