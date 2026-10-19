import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import type { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export function createPrimaryCardCustodyInboxIntake(input: {
  configuration: unknown;
  capability: string;
  execute: ReturnType<typeof createPrimaryCardCustodyExecutor>;
}) {
  const config = schemas.runtime
    .or(schemas.intakeRuntime)
    .parse(input.configuration);
  return async (rawBody: Uint8Array, signature: string | null) => {
    // No integration-deadline check: receipts complete transfers
    // dispatched before expiry, so post-expiry intake must still enqueue
    // for the worker to drain. The database gates on fresh intake
    // credentials, enabled flags, and the capability binding instead.
    const payload = Uint8Array.from(rawBody);
    if (
      signature === null ||
      payload.byteLength === 0 ||
      payload.byteLength > 65536 ||
      ![config.webhookSecret, ...(config.retainedWebhookSecrets ?? [])].some(
        (secret) =>
          verifyPiggyvestPayloadSignature({
            payload,
            signature,
            secret,
          })
      )
    )
      return 'invalid_signature' as const;
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(payload)
      );
    } catch {
      return 'invalid_payload' as const;
    }
    const parsed = schemas.envelope.safeParse(decoded);
    if (!parsed.success) return 'invalid_payload' as const;
    const event = parsed.data;
    if (
      event.eventType !== 'wallet-transfer.outflow.success' ||
      event.eventCategory !== 'wallet-transfer' ||
      event.customer_id !== config.crosswalkAuthority.treasuryWebhookCustomerId
    )
      return 'not_handled' as const;
    const routing = schemas.readiness.parse(
      await input.execute('inboxReadiness', [input.capability])
    );
    if (!routing.ready) return 'not_ready' as const;
    if (event.pvb_wallet !== routing.sourceWalletId)
      return 'not_handled' as const;
    // No reference gate: an authentic envelope with a verified type,
    // category, wallet, and customer is attributable evidence even when
    // the provider omits pvb_reference. Rejecting it here would 503
    // every redelivery until retries exhaust with no durable receipt,
    // while a completed treasury transfer may already exist. Enqueue
    // the bytes; the worker blocks the unprocessable receipt for
    // review with its evidence intact.
    return schemas.enqueue.parse(
      await input.execute('inboxEnqueue', [
        input.capability,
        Buffer.from(payload).toString('hex'),
        signature.toLowerCase(),
      ])
    );
  };
}
