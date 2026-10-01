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
 * caller's authority or input. Two pre-migration states defer: the pristine
 * one (neither role nor RPCs exist, so PostgREST fails at SET ROLE before
 * resolving the RPC) and the pre-isolation one (role and RPCs exist but the
 * authenticator membership grant is still pending, so SET ROLE is denied
 * with 42501). Without the pre-isolation shape the first rollout
 * deadlocks: deploy.sh refuses to install on a failed smoke while the
 * workflow refuses to apply the grant-fixing migrations until the worker
 * is installed. Other 42501s still fail closed.
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
    /role\s+"?[\w$]+"?\s+does not exist/i.test(message) ||
    (error.code === '42501' && /permission denied to set role/i.test(message))
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

const SCOPE_HOOK_DENIAL_MESSAGE =
  'GIGL worker request is outside its capability scope';

/**
 * Proves the PostgREST pre-request hook is ACTIVE, not merely installed.
 * The same reviewed wrapper is requested with HEAD, which only the hook
 * discriminates on (it requires POST): the hook's denial message proves
 * enforcement is live. Any other outcome fails the smoke — including the
 * 22023 the wrapper itself returns when reached without the hook, which
 * is exactly the missed-reload shape. Migration NOTIFY is
 * fire-and-forget: if PostgREST is down during the migration apply, the
 * catalog setting commits but the hook never activates, and the
 * allowed-path smoke above cannot detect that broader authority.
 */
export async function verifyGiglTrackingWorkerScopeProbe(
  client: GiglTrackingRpcClient
): Promise<boolean> {
  const { error } = await client.rpc(
    'claim_due_gigl_tracking_monitors',
    {
      p_limit: 0,
      p_worker_id: 'gigl-capability-scope-probe',
    },
    { head: true }
  );
  if (isGiglWrapperSchemaMissing(error)) {
    throw new GiglWrapperSchemaMissingError();
  }
  return (
    error?.code === '42501' &&
    (error.message ?? '').includes(SCOPE_HOOK_DENIAL_MESSAGE)
  );
}
