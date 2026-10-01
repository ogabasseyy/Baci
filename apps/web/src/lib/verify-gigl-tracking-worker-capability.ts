import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type GiglTrackingRpcClient = Pick<SupabaseClient<Database>, 'rpc'>;

/** Thrown when the wrapper RPCs are not deployed yet (pre-migration schema). */
export class GiglWrapperSchemaMissingError extends Error {
  constructor() {
    super('GIGL wrapper RPCs are not deployed yet');
    this.name = 'GiglWrapperSchemaMissingError';
  }
}

interface RpcErrorShape {
  code?: string;
  message?: string;
}

/**
 * Detects the PostgREST "function not in schema cache" shape, which proves
 * the wrapper migration has not applied yet — distinct from a reachable
 * wrapper rejecting the caller's authority or input.
 */
export function isGiglWrapperSchemaMissing(
  error: RpcErrorShape | null
): boolean {
  if (!error) {
    return false;
  }
  if (error.code === 'PGRST202') {
    return true;
  }
  return /could not find the function/i.test(error.message ?? '');
}

/** Proves the signed worker can reach its wrapper without claiming any work. */
export async function verifyGiglTrackingWorkerCapability(
  client: GiglTrackingRpcClient
): Promise<boolean> {
  const { error } = await client.rpc('claim_due_gigl_tracking_monitors', {
    p_limit: 0,
    p_worker_id: 'gigl-capability-preflight',
  });
  if (isGiglWrapperSchemaMissing(error)) {
    throw new GiglWrapperSchemaMissingError();
  }
  return error?.code === '22023';
}
