import 'server-only';
import { createHash } from 'node:crypto';
import { piggyvestPrimaryEngineReadySchema } from '@/schemas/piggyvest-primary-engine-ready';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from './primary-wallet-bank-inbox-store';
import { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';
import {
  acceptedWebhookSecrets,
  familyArchivedSecrets,
} from './webhook-key-archive';

// Missing marker ids when the engine refuses the bank inbox (an error or a
// malformed verdict reads as unavailable), or null when it is ready.
async function bankInboxEngineGaps(
  store: ReturnType<typeof createPrimaryWalletBankInboxStore>
): Promise<string[] | null> {
  try {
    const verdict = piggyvestPrimaryEngineReadySchema.safeParse(
      await store.engineReady()
    );
    if (verdict.success)
      return verdict.data.ready ? null : verdict.data.missing;
  } catch {
    // Falls through: a failed check is never permission.
  }
  return ['engine_readiness_unavailable'];
}

export async function drainPrimaryWalletBankInbox(
  input: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    batchSize?: number;
  } = {}
) {
  const totals: {
    claimed: number;
    processed: number;
    deferred: number;
    blocked: number;
    engineNotReady?: string[];
  } = { claimed: 0, processed: 0, deferred: 0, blocked: 0 };
  const config = readPrimaryWalletBankInboxRuntime('worker', input.env);
  if (!config || input.signal?.aborted) return totals;
  const store = createPrimaryWalletBankInboxStore(config);
  await store.readiness();
  // Hard check before any claim: until the engine fences are proven, or
  // when the check fails, nothing is claimed. Rows stay pending exactly as
  // captured (no attempt spent, no lease) and credit once after readiness.
  // The marker ids (never customer data) tell a gated drain from an empty
  // inbox.
  const engineGaps = await bankInboxEngineGaps(store);
  if (engineGaps) return { ...totals, engineNotReady: engineGaps };
  const batch = schemas.batch.parse({ batchSize: input.batchSize ?? 5 });
  const claims = schemas.claims.parse(await store.claim(batch));
  if (
    claims.length > batch.batchSize ||
    new Set(claims.map((claim) => claim.eventId)).size !== claims.length
  )
    throw new Error('Primary bank claims unavailable');
  totals.claimed = claims.length;
  // Stored rows replay: the family's archived keys past their overlap
  // still re-check bytes that were authentic when accepted. Derived and
  // bounded; the store above only ever sees the validated operator config.
  const signingSecrets = acceptedWebhookSecrets(
    config,
    familyArchivedSecrets(
      'bank',
      input.env ?? process.env,
      new Date(),
      'replay'
    )
  );
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
    const verified = signingSecrets.some((secret) =>
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
