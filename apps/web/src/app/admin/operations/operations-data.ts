import {
  type AdminOperations,
  type AdminOperationsApi,
  adminOperationsApiSchema,
} from '@/schemas/admin-operations-rpc';
import type {
  EventPipelineData,
  EventPipelineIncident,
  OperationsPageData,
  OperationsSection,
} from './operations-types';

function parseEventPipeline(data: unknown): EventPipelineData {
  if (!data || typeof data !== 'object')
    throw new Error('Invalid event pipeline data');
  const value = data as Partial<EventPipelineData>;
  if (!value.counts || !value.operations)
    throw new Error('Invalid event pipeline data');
  return {
    counts: value.counts,
    deliveries: value.deliveries ?? [],
    ingress: value.ingress ?? [],
    operations: value.operations,
    unknown: value.unknown ?? [],
  };
}

async function loadOperationsSection(
  offset: number
): Promise<OperationsSection<AdminOperationsApi>> {
  try {
    const response = await fetch(
      `/api/admin/operations?section=all&limit=25&offset=${offset}`
    );
    if (!response.ok) throw new Error('operations_request_failed');

    const parsed = adminOperationsApiSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('operations_payload_invalid');

    return { data: parsed.data, error: null };
  } catch {
    return {
      data: null,
      error: 'Operational incident data could not be loaded.',
    };
  }
}

async function loadEventPipelineSection(
  offset: number
): Promise<OperationsSection<EventPipelineData>> {
  try {
    const response = await fetch(
      `/api/admin/event-pipeline/dead-letters?kind=all&limit=25&offset=${offset}`
    );
    if (!response.ok) throw new Error('event_pipeline_request_failed');

    return { data: parseEventPipeline(await response.json()), error: null };
  } catch {
    return {
      data: null,
      error: 'Event pipeline incidents could not be loaded.',
    };
  }
}

export async function loadOperationsData(
  offset = 0
): Promise<OperationsPageData> {
  const [operations, eventPipeline] = await Promise.all([
    loadOperationsSection(offset),
    loadEventPipelineSection(offset),
  ]);

  return {
    eventPipeline,
    operations,
  };
}

export async function replayEventPipelineIncident(
  incident: EventPipelineIncident,
  kind: 'delivery' | 'ingress',
  reason: string
): Promise<{ replayed: number; success: boolean }> {
  const body =
    kind === 'ingress'
      ? { failure_id: incident.id, kind, reason }
      : { delivery_ids: [incident.id], kind, reason };
  const { fetchWithCsrf } = await import('@/lib/api-client');
  const response = await fetchWithCsrf('/api/admin/event-pipeline/replay', {
    body: JSON.stringify(body),
    method: 'POST',
  });
  if (!response.ok) throw new Error('Replay failed');
  return response.json();
}

export type { AdminOperations };
