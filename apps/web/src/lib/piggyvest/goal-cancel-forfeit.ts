import 'server-only';
import type { z } from 'zod';
import { piggyvestGoalCancelForfeitSchemas as schemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
import { PiggyvestApiError } from './client';
import { isDefinitiveNoTransferRejection } from './primary-wallet-savings-transfer';
import type { TransferReferenceLookup } from './transfer-reference-lookup';

export type GoalCancelForfeit = z.infer<typeof schemas.forfeit>;

type Claim =
  | { status: 'claimed'; forfeit: unknown }
  | { status: 'pending'; forfeitId: string }
  | { status: 'waiting' | 'confirmed' | 'none' }
  | { status: 'needs_review' | 'unavailable'; alert?: true };

export type GoalCancelForfeitOutcome =
  | 'pending'
  | 'confirmed'
  | 'released'
  | 'waiting'
  | 'needs_review'
  | 'none'
  | 'unavailable';

interface Ports {
  claim: (operationId: string) => Promise<Claim>;
  // Checked before the POST: the destination must be Ogabassey's own wallet
  // in this business (a mistyped configured wallet would send interest to
  // someone else, irreversibly). False or a failed check sends nothing.
  verifyDestination: (forfeit: GoalCancelForfeit) => Promise<boolean>;
  transfer: (forfeit: GoalCancelForfeit) => Promise<{ accepted: true }>;
  lookupTransfer: (
    forfeit: GoalCancelForfeit
  ) => Promise<TransferReferenceLookup>;
  // The forfeit's new state; 'needs_review' when this was the third
  // rejection (the caller pages), 'not_released' when it was not dispatched.
  release: (
    forfeitId: string
  ) => Promise<'released' | 'needs_review' | 'not_released'>;
  // Evidence-side status read of a dispatched forfeit (settle or release
  // from a verified provider record). Absent: the outcome stays pending.
  reconcile?: (forfeitId: string) => Promise<{ status: string }>;
}

/**
 * Sends an early-cancelled goal's interest to Ogabassey's interest wallet
 * (owner decision 2026-11-12). The database only lets this run once the
 * customer's principal is CONFIRMED, and claims the forfeit (reserved ->
 * dispatched) before its single POST, so it is sent at most once per
 * reference: a later call that finds it dispatched only reads its status.
 * A timeout or 202 is indeterminate (pending). Only a definitive rejection
 * with no transfer on record under the reference releases it, and the
 * database then plans a replacement under a fresh reference.
 */
export async function driveGoalCancelForfeit(
  operationId: string,
  ports: Ports
): Promise<GoalCancelForfeitOutcome> {
  const claim = await ports.claim(operationId);
  if (claim.status === 'pending')
    return await readStatus(claim.forfeitId, ports);
  if (claim.status !== 'claimed') return claim.status;
  const forfeit = schemas.forfeit.parse(claim.forfeit);
  // Nothing has been sent yet, so a destination that fails the check is
  // released (a fresh reference is planned; the third time goes to review).
  if (!(await ports.verifyDestination(forfeit).catch(() => false)))
    return await releaseUnsent(forfeit, ports);
  try {
    const response = await ports.transfer(forfeit);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch (error) {
    return await releaseIfDefinitivelyRejected(forfeit, error, ports);
  }
  return await readStatus(forfeit.operationId, ports);
}

async function readStatus(
  forfeitId: string,
  ports: Pick<Ports, 'reconcile'>
): Promise<GoalCancelForfeitOutcome> {
  if (!ports.reconcile) return 'pending';
  const outcome = await ports.reconcile(forfeitId);
  return outcome.status === 'confirmed' ? 'confirmed' : 'pending';
}

async function releaseIfDefinitivelyRejected(
  forfeit: GoalCancelForfeit,
  error: unknown,
  ports: Pick<Ports, 'lookupTransfer' | 'release'>
): Promise<'released' | 'needs_review' | 'pending'> {
  if (!isDefinitiveNoTransferRejection(error)) return 'pending';
  // The credential was refused or the relay proved it never reached
  // PiggyVest: no transfer exists, and a lookup would fail in the same
  // outage (leaving the forfeit dispatched for good), so release now.
  if (isAuthoritativeNotSent(error)) return await releaseUnsent(forfeit, ports);
  let lookup: TransferReferenceLookup;
  try {
    lookup = await ports.lookupTransfer(forfeit);
  } catch {
    return 'pending';
  }
  if (lookup !== 'not_found') return 'pending';
  return await releaseUnsent(forfeit, ports);
}

function isAuthoritativeNotSent(error: unknown): boolean {
  return (
    error instanceof PiggyvestApiError &&
    (error.code === 'PIGGYVEST_AUTH_ERROR' ||
      error.code === 'PIGGYVEST_RELAY_UNAVAILABLE')
  );
}

async function releaseUnsent(
  forfeit: GoalCancelForfeit,
  ports: Pick<Ports, 'release'>
): Promise<'released' | 'needs_review' | 'pending'> {
  const released = await ports.release(forfeit.operationId);
  return released === 'not_released' ? 'pending' : released;
}
