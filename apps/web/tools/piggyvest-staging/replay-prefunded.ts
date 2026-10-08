import type { ReplayEvent } from './replay-crypto';
import { DispatchQuarantine, type ReplayLease } from './replay-worker';
import { replayPrefundedSchemas as schemas } from './schemas/replay-prefunded';

export interface PrefundedReceiptReplay {
  resolveEnrollment(input: {
    receiptId: string;
    payloadSha256: string;
    eventId: string;
    eventType: ReplayEvent['eventType'];
    providerCustomerId: string;
    rawPayload: Uint8Array;
  }): Promise<unknown>;
  readOriginalSignature?(input: {
    receiptId: string;
    payloadSha256: string;
    claimToken: string;
  }): Promise<unknown>;
  replay(input: {
    rawPayload: Uint8Array;
    signature: string | null;
  }): Promise<unknown>;
}

export async function dispatchPrefundedReceipt(
  callbacks: PrefundedReceiptReplay,
  lease: ReplayLease,
  decoded: { raw: Buffer; event: ReplayEvent }
): Promise<'applied' | 'duplicate' | null> {
  const { event } = decoded;
  if (
    event.eventType !== 'bank-transfer.inflow.success' &&
    event.eventType !== 'wallet-transfer.outflow.success'
  )
    return null;
  const identity = {
    receiptId: lease.receiptId,
    payloadSha256: lease.sealed.payloadSha256,
  };
  const enrollment = schemas.enrollment.parse(
    await callbacks.resolveEnrollment({
      ...identity,
      eventId: event.eventId,
      eventType: event.eventType,
      providerCustomerId: event.customer_id,
      rawPayload: Uint8Array.from(decoded.raw),
    })
  );
  if (enrollment === 'legacy') return null;
  if (enrollment !== 'enrolled')
    throw new Error('Prefunded enrollment unresolved');
  if (!callbacks.readOriginalSignature)
    throw new Error('Original provider signature unavailable');
  const signature = schemas.originalSignature.parse(
    await callbacks.readOriginalSignature({
      ...identity,
      claimToken: lease.claimToken,
    })
  );
  if (!signature) throw new Error('Original provider signature unavailable');
  if (
    signature.receiptId !== identity.receiptId ||
    signature.payloadSha256 !== identity.payloadSha256
  )
    throw new Error('Original provider signature identity mismatch');
  const result = schemas.outcome.parse(
    await callbacks.replay({
      rawPayload: Uint8Array.from(decoded.raw),
      signature: signature.signature,
    })
  );
  if (result.outcome === 'retry')
    throw new Error('Prefunded evidence replay deferred');
  if (
    result.outcome === 'reconciliation_required' ||
    result.outcome === 'rejected'
  )
    throw new DispatchQuarantine({
      eventId: event.eventId,
      reason: result.outcome === 'rejected' ? 'poison' : 'conflict',
    });
  if (event.eventType === 'wallet-transfer.outflow.success') {
    if (result.projection !== 'not_applicable')
      throw new Error('Outflow receipt cannot project bank principal');
    return 'applied';
  }
  if (result.projection === 'not_applicable')
    throw new Error('Bank receipt requires a durable projection outcome');
  return result.projection;
}
