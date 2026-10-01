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
 * Detects the pre-migration schema shapes, which prove the wrapper migration
 * has not applied yet — distinct from a reachable wrapper rejecting the
 * caller's authority or input. On the first rollout neither the role nor the
 * RPCs exist, and PostgREST fails at SET ROLE before resolving the RPC, so
 * both the missing-role and the missing-function shapes must defer.
 */
export function isGiglWrapperSchemaMissing(
  error: RpcErrorShape | null
): boolean {
  if (!error) {
    return false;
  }
  if (error.code === 'PGRST202' || error.code === '42704') {
    return true;
  }
  const message = error.message ?? '';
  return (
    /could not find the function/i.test(message) ||
    /role\s+"?[\w$]+"?\s+does not exist/i.test(message)
  );
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
