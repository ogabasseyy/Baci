import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import {
  eventDeadLetterReplaySchema,
  eventPipelineReplayIdsSchema,
} from '@/schemas/event-dead-letter';
import type { Database } from '@/types/supabase';

interface ReplayRpcResult {
  data: unknown;
  error: { message: string } | null;
}

type AdminReplayRpc = (
  functionName:
    | 'replay_event_deliveries_batch_admin_v2'
    | 'replay_ingress_dead_letter_admin_v2'
    | 'select_event_pipeline_replay_ids_admin_v2',
  args: Record<string, unknown>
) => Promise<ReplayRpcResult>;

function getAdminReplayRpc(supabase: SupabaseClient<Database>) {
  return supabase.rpc as unknown as AdminReplayRpc;
}

async function resolveFilteredDeliveryIds(
  rpc: AdminReplayRpc,
  filter: Extract<
    ReturnType<typeof eventDeadLetterReplaySchema.parse>,
    { kind: 'delivery_filter' }
  >
) {
  const { data, error } = await rpc(
    'select_event_pipeline_replay_ids_admin_v2',
    {
      p_destination: filter.destination,
      p_error_code: filter.error_code ?? undefined,
      p_from: filter.from ?? undefined,
      p_merchant_id: filter.merchant_id ?? undefined,
      p_status: filter.status,
      p_to: filter.to ?? undefined,
    }
  );
  if (error) throw new Error('delivery_replay_filter_failed', { cause: error });
  const parsed = eventPipelineReplayIdsSchema.safeParse(data);
  if (!parsed.success) throw new Error('delivery_replay_filter_invalid');
  return parsed.data;
}

export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('operations.manage');
  if (auth.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (auth.status === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = eventDeadLetterReplaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'invalid_input', error: 'Invalid input' },
      { status: 400 }
    );
  }

  const supabase = await createClient('event-pipeline');
  const rpc = getAdminReplayRpc(supabase);
  let result: ReplayRpcResult;
  try {
    if (parsed.data.kind === 'ingress') {
      result = await rpc('replay_ingress_dead_letter_admin_v2', {
        p_failure_id: parsed.data.failure_id,
        p_replay_reason: parsed.data.reason,
      });
    } else {
      const deliveryIds =
        parsed.data.kind === 'delivery'
          ? parsed.data.delivery_ids
          : await resolveFilteredDeliveryIds(rpc, parsed.data);
      if (deliveryIds.length === 0) {
        return NextResponse.json({ replayed: 0, success: true });
      }
      result = await rpc('replay_event_deliveries_batch_admin_v2', {
        p_delivery_ids: deliveryIds,
        p_replay_reason: parsed.data.reason,
      });
    }
  } catch (error) {
    console.error('Event pipeline replay failed:', error);
    return NextResponse.json(
      { code: 'replay_failed', error: 'Replay failed' },
      { status: 500 }
    );
  }

  if (result.error) {
    console.error('Event pipeline replay failed:', result.error);
    return NextResponse.json(
      { code: 'replay_failed', error: 'Replay failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ replayed: result.data, success: true });
}
