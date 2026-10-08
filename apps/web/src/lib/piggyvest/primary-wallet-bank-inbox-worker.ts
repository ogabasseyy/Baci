import 'server-only';
import { createHash } from 'node:crypto';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from './primary-wallet-bank-inbox-store';
import { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function drainPrimaryWalletBankInbox(
  input: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    batchSize?: number;
  } = {}
) {
  const totals = { claimed: 0, processed: 0, deferred: 0, blocked: 0 };
  const config = readPrimaryWalletBankInboxRuntime('worker', input.env);
  if (!config || input.signal?.aborted) return totals;
  const store = createPrimaryWalletBankInboxStore(config);
  await store.readiness();
  const batch = schemas.batch.parse({ batchSize: input.batchSize ?? 5 });
  const claims = schemas.claims.parse(await store.claim(batch));
  if (
    claims.length > batch.batchSize ||
    new Set(claims.map((claim) => claim.eventId)).size !== claims.length
  )
    throw new Error('Primary bank claims unavailable');
  totals.claimed = claims.length;
  for (const claim of claims) {
    if (input.signal?.aborted) break;
    const raw = Buffer.from(claim.rawHex, 'hex');
    if (createHash('sha256').update(raw).digest('hex') !== claim.bodyDigest) {
      await store.retry({
        eventId: claim.eventId,
        token: claim.token,
        reason: 'invalid_receipt',
      });
      totals.blocked++;
      continue;
    }
    const verified = [
      config.webhookSecret,
      ...config.retainedWebhookSecrets,
    ].some((secret) =>
      verifyPiggyvestPayloadSignature({
        payload: raw,
        signature: claim.signature,
        secret,
      })
    );
    if (!verified) {
      await store.retry({
        eventId: claim.eventId,
        token: claim.token,
        reason: 'io_retry',
      });
      throw new Error('Primary bank receipt signing key unavailable');
    }
    let receipt: ReturnType<typeof preparePrimaryWalletInflowReceipt>;
    try {
      receipt = preparePrimaryWalletInflowReceipt(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
      );
      if (receipt.eventId !== claim.eventId)
        throw new Error('Invalid identity');
    } catch {
      await store.retry({
        eventId: claim.eventId,
        token: claim.token,
        reason: 'invalid_receipt',
      });
      totals.blocked++;
      continue;
    }
    try {
      const outcome = await store.process({
        eventId: claim.eventId,
        token: claim.token,
        receipt: { ...receipt, bodyDigest: claim.bodyDigest },
      });
      if (outcome === 'credited' || outcome === 'duplicate') totals.processed++;
      else if (outcome === 'prerequisite') totals.deferred++;
      else totals.blocked++;
    } catch {
      await store.retry({
        eventId: claim.eventId,
        token: claim.token,
        reason: 'io_retry',
      });
      throw new Error('Primary bank inbox processing unavailable');
    }
  }
  return totals;
}
