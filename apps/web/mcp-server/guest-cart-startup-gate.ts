import type { SupabaseClient } from '@supabase/supabase-js';
import { probeGuestCartCapability } from './guest-cart-capability-probe';

export const GUEST_CART_STARTUP_PROBE_TIMEOUT_MS = 10_000;

export interface GuestCartStartupGate {
  client: Pick<SupabaseClient, 'rpc'>;
  /** Runs only after the capability probe passes (the server listens here). */
  onReady: () => void;
  /** Process exit, injectable so tests never kill the runner. */
  exit?: (code: number) => never;
  timeoutMs?: number;
}

/**
 * Startup capability probe: the offline token check cannot verify the JWT
 * signature, issuer, or project, so prove the whole chain with one
 * read-only RPC before listening — a mis-issued token must fail the
 * deploy through the /health curl loop, not promote a release whose
 * carts are dead on arrival. A database outage fails the same way:
 * without PostgREST the server serves nothing useful, and crashlooping
 * beats a green-but-dead deploy. (Steady-state health is unchanged:
 * runtime cart failures still degrade per-call, never red the probe.)
 * A rejection here is unreachable (the probe never throws), but a hung
 * boot must fail closed rather than idle past the deploy's /health
 * curl loop. Split from server.ts, which is far past the 300-line
 * budget for touched logic.
 */
export function gateStartupOnGuestCartCapability(
  gate: GuestCartStartupGate
): Promise<void> {
  const timeoutMs =
    gate.timeoutMs ?? GUEST_CART_STARTUP_PROBE_TIMEOUT_MS;
  const exit = gate.exit ?? ((code: number): never => process.exit(code));
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('probe_timeout'), timeoutMs);
  });
  return Promise.race([probeGuestCartCapability(gate.client), timeout])
    .finally(() => clearTimeout(timer))
    .then(
      (capabilityFailure) => {
        if (capabilityFailure !== null) {
          // The code is token-free (a PostgREST/transport code, never
          // the JWT).
          console.error('FATAL: Guest-cart worker capability probe failed');
          console.error(`code=${capabilityFailure}`);
          exit(1);
          return;
        }
        gate.onReady();
      },
      () => {
        console.error('FATAL: Guest-cart worker capability probe failed');
        console.error('code=probe_error');
        exit(1);
      }
    );
}
