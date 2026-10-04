import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { interestAccruedSuccessEventSchema } from '../../src/schemas/piggyvest/interest-accrued-event';
import { PIGGYVEST_ACCRUAL_REPLAY_STATEMENT } from './replay-accrual-statement';
import type { createReplaySignatureReader } from './replay-signature-reader';
import { DispatchQuarantine, type ReplayLease } from './replay-worker';
import { replayAccrualSigningSecretSchema } from './schemas/replay-accrual';
import { replayFinancialSchemas } from './schemas/replay-financial';
import { replayPrefundedSchemas } from './schemas/replay-prefunded';
import { replaySignatureLookupSchema } from './schemas/replay-signature-reader';

export function createAccrualReplay(
  scope: unknown,
  signingSecret: unknown,
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>
) {
  const config = replayFinancialSchemas.scope.parse(scope);
  const secret = replayAccrualSigningSecretSchema.parse(signingSecret);
  return async (input: {
    lease: ReplayLease;
    raw: Buffer;
    readOriginalSignature: ReturnType<typeof createReplaySignatureReader>;
  }): Promise<'applied' | 'duplicate'> => {
    const { lease, raw } = input;
    const lookup = replaySignatureLookupSchema.safeParse({
      receiptId: lease.receiptId,
      payloadSha256: lease.sealed.payloadSha256,
      claimToken: lease.claimToken,
    });
    if (!lookup.success || raw.length === 0 || raw.length > 131072)
      throw new DispatchQuarantine({ reason: 'poison' });
    const digest = createHash('sha256').update(raw).digest('hex');
    if (digest !== lookup.data.payloadSha256)
      throw new DispatchQuarantine({ reason: 'conflict' });
    let rawPayload: string;
    let payload: unknown;
    try {
      rawPayload = new TextDecoder('utf-8', { fatal: true }).decode(raw);
      payload = JSON.parse(rawPayload) as unknown;
    } catch {
      throw new DispatchQuarantine({ reason: 'poison' });
    }
    const parsed = interestAccruedSuccessEventSchema.safeParse(payload);
    if (!parsed.success) throw new DispatchQuarantine({ reason: 'poison' });
    if (lease.eventId !== null && lease.eventId !== parsed.data.eventId)
      throw new DispatchQuarantine({ reason: 'conflict' });
    let signature: unknown;
    try {
      signature = await input.readOriginalSignature(lookup.data);
    } catch {
      throw new Error('Interest accrual replay deferred');
    }
    const proof = replayPrefundedSchemas.originalSignature.safeParse(signature);
    if (!proof.success) throw new DispatchQuarantine({ reason: 'poison' });
    if (!proof.data) throw new Error('Interest accrual replay deferred');
    if (
      proof.data.receiptId !== lease.receiptId ||
      proof.data.payloadSha256 !== digest ||
      !timingSafeEqual(
        Buffer.from(proof.data.signature, 'hex'),
        createHmac('sha512', secret).update(raw).digest()
      )
    )
      throw new DispatchQuarantine({ reason: 'conflict' });
    let rows: unknown;
    try {
      rows = (
        await execute(PIGGYVEST_ACCRUAL_REPLAY_STATEMENT.text, [
          config.integrationId,
          config.businessId,
          config.expectedSystemId,
          lease.receiptId,
          digest,
          rawPayload,
        ])
      ).rows;
    } catch {
      throw new Error('Interest accrual replay deferred');
    }
    const result = replayFinancialSchemas.outcome.safeParse(rows);
    if (!result.success) throw new Error('Interest accrual replay deferred');
    const outcome = result.data[0].result;
    if (outcome === 'invalid' || outcome === 'conflict')
      throw new DispatchQuarantine({
        reason: outcome === 'invalid' ? 'poison' : 'conflict',
      });
    if (outcome === 'deferred')
      throw new Error('Interest accrual replay deferred');
    return outcome;
  };
}
