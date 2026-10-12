import 'server-only';
import { createHash } from 'node:crypto';
import { isUint8Array } from 'node:util/types';
import { prefundedCardLegacyProofSchemas as schemas } from '@/schemas/prefunded-card-legacy-proof';
import { prefundedCardProviderEvidenceSchemas as evidence } from '@/schemas/prefunded-card-provider-evidence';
import { decryptPrefundedCardLegacyReceipt } from './prefunded-card-legacy-receipt';
import { normalizePrefundedCardProviderEvidence } from './prefunded-card-provider-evidence-normalize';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

const SYSTEM_IDENTIFIER = '7685292944002592802';
const DEADLINE = Date.parse('2026-09-29T15:59:10Z');
const MAX_VERIFICATION_MS = 30_000;

export async function verifyPrefundedCardLegacyProof({
  configuration,
  legacy: rawLegacy,
  receipt,
  fetchImplementation,
  now = Date.now,
  monotonicNow = () => performance.now(),
}: {
  configuration: unknown;
  legacy: unknown;
  receipt: {
    receiptId: unknown;
    payloadSha256: unknown;
    rawPayload: unknown;
    signature: string | null;
    sealed?: unknown;
    encryptionKey?: unknown;
  };
  fetchImplementation: typeof fetch;
  now?: () => number;
  monotonicNow?: () => number;
}) {
  let phase = 'input';
  try {
    const startedAt = now();
    const monotonicStartedAt = monotonicNow();
    const settings = evidence.configuration.parse(configuration);
    const legacy = schemas.legacy.parse(rawLegacy);
    const identity = schemas.receiptIdentity.parse({
      receiptId: receipt.receiptId,
      payloadSha256: receipt.payloadSha256,
    });
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(monotonicStartedAt) ||
      startedAt >= DEADLINE ||
      settings.systemIdentifier !== SYSTEM_IDENTIFIER ||
      settings.integrationId !== legacy.integrationId ||
      settings.piggyvest.expectedCurrency !== 'NGN' ||
      !isUint8Array(receipt.rawPayload) ||
      receipt.rawPayload.byteLength === 0 ||
      receipt.rawPayload.byteLength > 65536
    )
      throw new Error();
    const payload = Uint8Array.from(receipt.rawPayload);
    if (
      createHash('sha256').update(payload).digest('hex') !==
        identity.payloadSha256 ||
      (receipt.signature !== null &&
        !verifyPiggyvestPayloadSignature({
          payload,
          signature: receipt.signature,
          secret: settings.webhookSecret,
        }))
    )
      throw new Error();
    if (receipt.signature === null) {
      const storedRaw = decryptPrefundedCardLegacyReceipt(
        receipt.sealed,
        receipt.encryptionKey
      );
      if (!storedRaw.equals(Buffer.from(payload))) throw new Error();
    }
    phase = 'legacy-fields';
    const envelope = evidence.envelope.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    );
    const bank = evidence.bank.parse(envelope.eventData);
    if (
      envelope.eventType !== 'bank-transfer.inflow.success' ||
      !['bank-transfer', 'inflow_transaction'].includes(
        envelope.eventCategory
      ) ||
      envelope.eventId !== legacy.eventId ||
      envelope.customer_id !== legacy.providerCustomerId ||
      bank.customer_id !== legacy.providerCustomerId ||
      bank.id !== legacy.eventDataId ||
      bank.transaction_id !== legacy.providerTransactionId ||
      bank.amount !== legacy.amountKobo ||
      bank.fee !== legacy.feeKobo ||
      bank.reference !== legacy.reference ||
      (bank.session_id ?? null) !== legacy.sessionId ||
      !bank.timestamp ||
      Date.parse(bank.timestamp) !== Date.parse(legacy.creditedAt) ||
      Date.parse(bank.timestamp) > startedAt ||
      !envelope.pvb_reference ||
      !envelope.pvb_wallet
    )
      throw new Error();
    const referenceValues = [
      envelope.pvb_reference,
      envelope.pvb_third_party_reference,
      bank.id,
      bank.transaction_id,
      bank.reference,
      bank.third_party_reference,
      bank.internal_reference,
      bank.initiator_reference,
      bank.session_id,
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    const observation = evidence.observation.parse({
      eventId: envelope.eventId,
      fingerprint: identity.payloadSha256,
      eventType: envelope.eventType,
      eventCategory: envelope.eventCategory,
      eventDataId: bank.id,
      envelopeWalletId: envelope.pvb_wallet,
      sessionId: bank.session_id ?? null,
      creditedAt: null,
      status: 'deferred',
      kind: 'unknown',
      providerTransactionId: envelope.pvb_reference,
      destinationCustomerId: envelope.customer_id,
      sourceWalletId: null,
      destinationWalletId: null,
      reference: null,
      references: [...new Set(referenceValues)],
      amountKobo: null,
      feeKobo: null,
      currency: null,
    });
    phase = 'provider-read';
    const providerSnapshots: Array<{
      response: Response;
      retrievedAt: number;
    }> = [];
    const verified = await normalizePrefundedCardProviderEvidence({
      configuration: settings,
      envelope,
      observation,
      fetchImplementation: async (url, init) => {
        const response = await fetchImplementation(url, init);
        if (
          String(url).startsWith(
            `${settings.piggyvest.apiBaseUrl}/api/v1/transaction/`
          )
        ) {
          providerSnapshots.push({
            response: response.clone(),
            retrievedAt: now(),
          });
        }
        return response;
      },
      resolveDestination: async (walletId) =>
        walletId === legacy.providerWalletId
          ? {
              providerWalletId: legacy.providerWalletId,
              providerCustomerId: legacy.providerCustomerId,
            }
          : null,
    });
    phase = 'provider-match';
    if (!verified || providerSnapshots.length !== 1) throw new Error();
    const snapshot = providerSnapshots[0];
    const responseBytes = new Uint8Array(await snapshot.response.arrayBuffer());
    if (responseBytes.byteLength > settings.piggyvest.maxResponseBytes)
      throw new Error();
    const finishedAt = now();
    const monotonicFinishedAt = monotonicNow();
    if (
      verified?.status !== 'verified' ||
      verified.kind !== 'bank_inflow' ||
      verified.providerTransactionId !== envelope.pvb_reference ||
      verified.destinationWalletId !== legacy.providerWalletId ||
      verified.destinationCustomerId !== legacy.providerCustomerId ||
      verified.amountKobo !== legacy.amountKobo ||
      verified.feeKobo !== 0 ||
      verified.currency !== 'NGN' ||
      verified.sourceWalletId !== '' ||
      !Number.isFinite(finishedAt) ||
      !Number.isFinite(snapshot.retrievedAt) ||
      snapshot.retrievedAt < startedAt ||
      snapshot.retrievedAt > finishedAt ||
      finishedAt < startedAt ||
      finishedAt - startedAt > MAX_VERIFICATION_MS ||
      !Number.isFinite(monotonicFinishedAt) ||
      monotonicFinishedAt < monotonicStartedAt ||
      monotonicFinishedAt - monotonicStartedAt > MAX_VERIFICATION_MS ||
      finishedAt >= DEADLINE
    )
      throw new Error();
    return {
      ...identity,
      legacyProviderTransactionId: legacy.providerTransactionId,
      contributionId: legacy.contributionId,
      observation: verified,
      verifiedAt: new Date(finishedAt).toISOString(),
      providerReconciliation: {
        transactionId: verified.providerTransactionId,
        responseSha256: createHash('sha256')
          .update(responseBytes)
          .digest('hex'),
        retrievedAt: new Date(snapshot.retrievedAt).toISOString(),
      },
      provenance:
        receipt.signature === null
          ? ('provider_reconciliation' as const)
          : ('original_signature_and_provider_reconciliation' as const),
    };
  } catch {
    throw new Error('Legacy proof refused', { cause: phase });
  }
}
