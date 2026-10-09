import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { primaryWalletPaidInterestSchemas } from '@/schemas/primary-wallet-paid-interest';
import { primaryWalletPaidInterestInboxSchemas as schemas } from '@/schemas/primary-wallet-paid-interest-inbox';
import { dispatchPrimaryWalletPaidInterest } from './primary-wallet-paid-interest-dispatch';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function drainPrimaryWalletPaidInterestInbox(input: {
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
  batchSize?: number;
}) {
  const totals = { claimed: 0, processed: 0, deferred: 0, quarantined: 0 };
  const config = readPrimaryWalletPaidInterestInboxRuntime('worker', input.env);
  if (!config || input.signal?.aborted) return totals;
  const store = createPrimaryWalletPaidInterestInboxStore(config);
  const request = schemas.claim.parse({ batchSize: input.batchSize ?? 5 });
  const claims = schemas.claims.parse(await store.claim(request));
  if (
    claims.length > request.batchSize ||
    new Set(claims.map((claim) => claim.eventId)).size !== claims.length
  )
    throw new Error('Primary interest inbox claims unavailable');
  totals.claimed = claims.length;
  for (const claim of claims) {
    if (input.signal?.aborted) break;
    let outcome: z.infer<typeof schemas.finish>['outcome'];
    const rawBody = Buffer.from(claim.rawHex, 'hex');
    const signingSecret = [
      config.webhookSecret,
      ...(config.retainedWebhookSecrets ?? []),
    ].find((secret) =>
      verifyPiggyvestPayloadSignature({
        payload: rawBody,
        signature: claim.signature,
        secret,
      })
    );
    try {
      if (
        createHash('sha256').update(rawBody).digest('hex') !== claim.bodyDigest
      )
        outcome = 'invalid_receipt';
      else if (!signingSecret) outcome = 'io_retry';
      else {
        const event = primaryWalletPaidInterestSchemas.event.safeParse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
        );
        if (!event.success || event.data.eventId !== claim.eventId)
          outcome = 'invalid_receipt';
        else {
          const breakdown = event.data.eventData.break_down;
          if (
            breakdown.gross_interest_payout - breakdown.withholding_tax !==
              breakdown.net_interest_payout ||
            event.data.eventData.amount !== breakdown.net_interest_payout
          )
            outcome = 'invalid_receipt';
          else {
            const dispatched = await dispatchPrimaryWalletPaidInterest({
              ...input,
              env: {
                ...(input.env ?? process.env),
                PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: signingSecret,
              },
              rawBody,
              signature: claim.signature,
            });
            // Enqueue already gates on crosswalk involvement, so a decline here
            // means the crosswalk vanished mid-flight: quarantine for
            // operator review rather than silently dropping the payout.
            outcome =
              dispatched === 'disabled'
                ? 'prerequisite'
                : dispatched === 'not_handled'
                  ? 'conflict'
                  : dispatched;
          }
        }
      }
    } catch {
      outcome = 'io_retry';
    }
    try {
      schemas.acknowledgement.parse(
        await store.finish({
          eventId: claim.eventId,
          token: claim.token,
          outcome,
        })
      );
    } catch {
      throw new Error('Primary interest inbox worker unavailable');
    }
    if (outcome === 'io_retry')
      throw new Error('Primary interest inbox worker unavailable');
    if (outcome === 'credited' || outcome === 'duplicate') totals.processed++;
    else if (outcome === 'conflict' || outcome === 'invalid_receipt')
      totals.quarantined++;
    else totals.deferred++;
  }
  return totals;
}
