import { type NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import {
  type EventDeadLetterQuery,
  eventDeadLetterQuerySchema,
  eventPipelineDeliveryListSchema,
  eventPipelineIngressListSchema,
  eventPipelineOperationsSchema,
} from '@/schemas/event-dead-letter';

type EventPipelineSupabase = Awaited<ReturnType<typeof createClient>>;

function queryInput(request: NextRequest) {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}

async function listIngress(
  supabase: EventPipelineSupabase,
  query: EventDeadLetterQuery
) {
  const { data, error } = await supabase.rpc(
    'list_event_pipeline_ingress_failures_admin_v3',
    {
      p_error_code: query.error_code ?? undefined,
      p_from: query.from ?? undefined,
      p_limit: query.limit,
      p_merchant_id: query.merchant_id ?? undefined,
      p_offset: query.offset,
      p_to: query.to ?? undefined,
    }
  );
  if (error)
    throw new Error('ingress_dead_letter_query_failed', { cause: error });
  const parsed = eventPipelineIngressListSchema.safeParse(data);
  if (!parsed.success) throw new Error('ingress_dead_letter_query_invalid');
  return parsed.data;
}

async function listDeliveries(
  supabase: EventPipelineSupabase,
  query: EventDeadLetterQuery,
  status: 'dead_letter' | 'delivery_unknown'
) {
  const { data, error } = await supabase.rpc(
    'list_event_pipeline_deliveries_admin_v3',
    {
      p_destination: query.destination ?? undefined,
      p_error_code: query.error_code ?? undefined,
      p_from: query.from ?? undefined,
      p_limit: query.limit,
      p_merchant_id: query.merchant_id ?? undefined,
      p_offset: query.offset,
      p_status: status,
      p_to: query.to ?? undefined,
    }
  );
  if (error)
    throw new Error('delivery_dead_letter_query_failed', { cause: error });
  const parsed = eventPipelineDeliveryListSchema.safeParse(data);
  if (!parsed.success) throw new Error('delivery_dead_letter_query_invalid');
  return parsed.data;
}

async function operationalState(supabase: EventPipelineSupabase) {
  const { data, error } = await supabase.rpc(
    'get_event_pipeline_operations_admin_v3'
  );
  if (error) {
    throw new Error('event_pipeline_operational_state_failed');
  }
  const parsed = eventPipelineOperationsSchema.safeParse(data);
  if (!parsed.success) throw new Error('event_pipeline_operations_invalid');
  return parsed.data;
}

export async function GET(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('operations.read');
  if (auth.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (auth.status === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = eventDeadLetterQuerySchema.safeParse(queryInput(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const query = parsed.data;
    const supabase = await createClient('event-pipeline');
    const [ingress, deliveries, unknown, operations] = await Promise.all([
      query.kind === 'all' || query.kind === 'ingress'
        ? listIngress(supabase, query)
        : Promise.resolve({ count: 0, items: [] }),
      query.kind === 'all' || query.kind === 'delivery'
        ? listDeliveries(supabase, query, 'dead_letter')
        : Promise.resolve({ count: 0, items: [] }),
      query.kind === 'all' || query.kind === 'unknown'
        ? listDeliveries(supabase, query, 'delivery_unknown')
        : Promise.resolve({ count: 0, items: [] }),
      operationalState(supabase),
    ]);

    return NextResponse.json({
      counts: {
        deliveries: deliveries.count,
        ingress: ingress.count,
        unknown: unknown.count,
      },
      deliveries: deliveries.items,
      ingress: ingress.items,
      operations,
      unknown: unknown.items,
    });
  } catch {
    console.error('Event pipeline DLQ query failed');
    return NextResponse.json(
      { error: 'Failed to load event pipeline failures' },
      { status: 500 }
    );
  }
}
