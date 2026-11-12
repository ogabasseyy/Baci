import 'server-only';
import type { z } from 'zod';
import { piggyvestGoalCancelForfeitSchemas as schemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
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
  transfer: (forfeit: GoalCancelForfeit) => Promise<{ accepted: true }>;
  lookupTransfer: (
    forfeit: GoalCancelForfeit
  ) => Promise<TransferReferenceLookup>;
  release: (forfeitId: string) => Promise<boolean>;
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
  try {
    const response = await ports.transfer(forfeit);
    if (response.accepted !== true) throw new Error('Invalid acceptance');
  } catch (error) {
    if (await releaseIfDefinitivelyRejected(forfeit, error, ports))
      return 'released';
    return 'pending';
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
): Promise<boolean> {
  if (!isDefinitiveNoTransferRejection(error)) return false;
  let lookup: TransferReferenceLookup;
  try {
    lookup = await ports.lookupTransfer(forfeit);
  } catch {
    return false;
  }
  if (lookup !== 'not_found') return false;
  return await ports.release(forfeit.operationId);
}
