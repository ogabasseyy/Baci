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
 * The same reviewed wrapper is requested with GET, which only the hook
 * discriminates on (it requires POST): the hook's denial message proves
 * enforcement is live. Any other outcome fails the smoke — including the
 * 22023 the wrapper itself returns when reached without the hook, which
 * is exactly the missed-reload shape. Migration NOTIFY is
 * fire-and-forget: if PostgREST is down during the migration apply, the
 * catalog setting commits but the hook never activates, and the
 * allowed-path smoke above cannot detect that broader authority.
 *
 * GET — never HEAD — because the denial must be READABLE: HEAD
 * responses carry no body, so supabase-js surfaces `{ message: '' }`
 * with no code and the matcher below could never pass. (See
 * PostgrestBuilder.processResponse: an empty body fails JSON.parse and
 * yields a codeless error.)
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
    { get: true }
  );
  if (isGiglWrapperSchemaMissing(error)) {
    throw new GiglWrapperSchemaMissingError();
  }
  return (
    error?.code === '42501' &&
    (error.message ?? '').includes(SCOPE_HOOK_DENIAL_MESSAGE)
  );
}

/**
 * Proves the hook enforces the PATH allowlist, not just the POST
 * method. POSTs the inner claim RPC — a real, schema-typed function
 * outside the five wrapper paths — and requires the hook's own
 * denial. Callers MUST pass the unmapped scope-probe client: the
 * restricted client remaps this inner name to its approved wrapper,
 * which the hook permits, so the probe could never observe the
 * denial through it. A hook weakened to method-only lets this
 * through, but the inner function raises before any write (it
 * demands service_role), so the probe is harmless either way and
 * only the intact hook satisfies it.
 *
 * No schema-missing deferral, unlike the probes above: this runs
 * strictly after a schema-proving probe (the wrapper check, or the
 * GET probe on the disabled path — both throw 42 pre-migration), so
 * anything but the hook's denial is definitively a weakened hook. A
 * method-only hook surfaces this POST as an inner-function error,
 * which must fail closed, never defer.
 */
export async function verifyGiglTrackingWorkerScopePathProbe(
  client: GiglTrackingRpcClient
): Promise<boolean> {
  const { error } = await client.rpc('claim_due_gigl_tracking_monitors', {
    p_limit: 0,
    p_worker_id: 'gigl-capability-path-probe',
  });
  return (
    error?.code === '42501' &&
    (error.message ?? '').includes(SCOPE_HOOK_DENIAL_MESSAGE)
  );
}
