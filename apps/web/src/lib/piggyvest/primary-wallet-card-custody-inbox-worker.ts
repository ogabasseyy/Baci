import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import type { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import type { createPrimaryCardCustodyInboxMapping } from './primary-wallet-card-custody-inbox-mapping';
import type { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';
import { applyPrimaryCardSignedCustody } from './primary-wallet-card-custody-signed';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export function createPrimaryCardCustodyInboxWorker(input: {
  configuration: unknown;
  capability: string;
  execute: ReturnType<typeof createPrimaryCardCustodyExecutor>;
  resolveOperation: ReturnType<typeof createPrimaryCardCustodyInboxMapping>;
  observe: ReturnType<typeof createPrimaryCardCustodyReader>;
  now?: () => number;
}) {
  const config = schemas.runtime.parse(input.configuration);
  return async (signal?: AbortSignal) => {
    const totals = {
      claimed: 0,
      receiptsProcessed: 0,
      deferred: 0,
      blocked: 0,
    };
    if (signal?.aborted) return totals;
    const now = (input.now ?? Date.now)();
    // No integration-deadline check: the worker drains pre-existing
    // inbox rows past expiry (reserve is the strict new-work gate).
    if (!Number.isFinite(now))
      throw new Error('Signed custody worker unavailable');
    const readiness = schemas.readiness.parse(
      await input.execute('inboxReadiness', [input.capability])
    );
    if (!readiness.ready)
      throw new Error('Signed custody capability unavailable');
    const claims = schemas.claims.parse(
      await input.execute('inboxClaim', [
        input.capability,
        String(config.signedInbox.batchSize),
      ])
    );
    if (
      claims.length > config.signedInbox.batchSize ||
      new Set(claims.map((claim) => claim.eventId)).size !== claims.length
    )
      throw new Error('Signed custody claims unavailable');
    totals.claimed = claims.length;
    for (const claim of claims) {
      if (signal?.aborted) break;
      let outcome: 'completed' | 'duplicate' | 'deferred' | 'conflict';
      try {
        const payload = Buffer.from(claim.rawHex, 'hex');
        if (
          !verifyPiggyvestPayloadSignature({
            payload,
            signature: claim.signature,
            secret: config.webhookSecret,
          })
        )
          outcome = 'deferred';
        else {
          const parsed = schemas.envelope.safeParse(
            JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(payload)
            )
          );
          if (
            !parsed.success ||
            parsed.data.eventId !== claim.eventId ||
            parsed.data.eventType !== 'wallet-transfer.outflow.success' ||
            parsed.data.eventCategory !== 'wallet-transfer' ||
            parsed.data.pvb_wallet !== readiness.sourceWalletId ||
            parsed.data.customer_id !==
              config.crosswalkAuthority.treasuryWebhookCustomerId
          )
            outcome = 'conflict';
          else {
            const operationId = await input.resolveOperation(parsed.data);
            outcome =
              operationId === null
                ? 'deferred'
                : await applyPrimaryCardSignedCustody({
                    rawBody: payload,
                    signature: claim.signature,
                    secret: config.webhookSecret,
                    operationId,
                    inboxToken: claim.token,
                    loadContext: (selected) =>
                      input.execute('context', [selected]),
                    observe: input.observe,
                    settle: (proof) =>
                      input.execute('settle', [JSON.stringify(proof)]),
                    now: input.now,
                  });
          }
        }
      } catch {
        schemas.acknowledgement.parse(
          await input.execute('inboxFinish', [
            input.capability,
            claim.eventId,
            claim.token,
            'io_retry',
          ])
        );
        throw new Error('Signed custody worker unavailable');
      }
      schemas.acknowledgement.parse(
        await input.execute('inboxFinish', [
          input.capability,
          claim.eventId,
          claim.token,
          outcome,
        ])
      );
      if (outcome === 'completed' || outcome === 'duplicate')
        totals.receiptsProcessed++;
      else if (outcome === 'conflict') totals.blocked++;
      else totals.deferred++;
    }
    return totals;
  };
}
