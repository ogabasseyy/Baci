import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  OxygenPaymentRecoveryRequest,
  OxygenPaymentRecoveryState,
} from '@/schemas/oxygen-payment-recovery';

/** Refresh authoritative payment status into the recovery ledger for this exact booking. */
export async function confirmOxygenPaymentForActivation(
  snapshot: {
    workflowId: string;
    version: number;
    state: {
      bookingReference?: string | null;
      paymentComplete?: boolean;
      setupComplete?: boolean;
    };
  },
  recover: (
    request: OxygenPaymentRecoveryRequest
  ) => Promise<OxygenPaymentRecoveryState>
): Promise<boolean> {
  if (!snapshot.state.paymentComplete || !snapshot.state.setupComplete)
    return false;
  const reference = z.uuid().parse(snapshot.state.bookingReference);
  const status = await recover({
    workflowId: z.uuid().parse(snapshot.workflowId),
    reference,
    version: z.number().int().nonnegative().parse(snapshot.version),
    idempotencyKey: randomUUID(),
    action: 'check_status',
  });
  return (
    status.reference === reference &&
    status.paymentComplete === true &&
    status.setupComplete === true &&
    status.lastOutcome === 'succeeded' &&
    status.checkedAt !== null &&
    !status.pending
  );
}
