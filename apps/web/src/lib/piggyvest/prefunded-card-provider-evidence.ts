import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isUint8Array } from 'node:util/types';
import { prefundedCardClaimedRequestSchema } from '@/schemas/prefunded-card-claimed-request';
import { prefundedCardProviderEvidenceSchemas as schemas } from '@/schemas/prefunded-card-provider-evidence';
import { normalizePrefundedCardProviderEvidence } from './prefunded-card-provider-evidence-normalize';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;
type StoredVerification = ReturnType<
  typeof schemas.verificationRows.parse
>[number]['result'];
type Verification =
  | Exclude<StoredVerification, { outcome: 'verified_success' }>
  | {
      outcome: 'verified_success';
      evidence: Extract<
        StoredVerification,
        { outcome: 'verified_success' }
      >['evidence'];
    };

export function createPrefundedCardProviderEvidence({
  configuration,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  execute: Execute;
  fetchImplementation: typeof fetch;
}) {
  const settings = schemas.configuration.parse(configuration);
  const scope = [settings.integrationId, settings.systemIdentifier];
  const record = async (observation: unknown) =>
    schemas.recordRows.parse(
      (
        await execute(
          'SELECT prefunded_card.record_provider_evidence($1::uuid,$2::text,$3::jsonb) AS result',
          [...scope, JSON.stringify(schemas.observation.parse(observation))]
        )
      ).rows
    )[0].result;
  return {
    async ingest({
      rawPayload,
      signature,
    }: {
      rawPayload: unknown;
      signature: string | null;
    }) {
      if (
        !isUint8Array(rawPayload) ||
        rawPayload.byteLength === 0 ||
        rawPayload.byteLength > 65536
      )
        return { outcome: 'invalid_payload' } as const;
      const payload = Uint8Array.from(rawPayload);
      if (
        !verifyPiggyvestPayloadSignature({
          payload,
          signature,
          secret: settings.webhookSecret,
        })
      )
        return { outcome: 'invalid_signature' } as const;
      let body: unknown;
      try {
        body = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(payload)
        );
      } catch {
        return { outcome: 'invalid_payload' } as const;
      }
      const parsed = schemas.envelope.safeParse(body);
      if (!parsed.success) return { outcome: 'invalid_payload' } as const;
      const envelope = parsed.data;
      const receipt = schemas.scopeRows.parse(
        (
          await execute(
            'SELECT prefunded_card.evidence_scope($1::uuid,$2::text) AS result',
            scope
          )
        ).rows
      )[0].result;
      if (
        receipt.businessId !== settings.piggyvest.expectedBusinessId ||
        receipt.currency !== settings.piggyvest.expectedCurrency
      )
        throw new Error('Provider evidence scope refused');
      const referenceKeys = [
        'id',
        'transaction_id',
        'reference',
        'third_party_reference',
        'internal_reference',
        'initiator_reference',
        'session_id',
      ];
      const references = [
        envelope.pvb_reference,
        envelope.pvb_third_party_reference,
        ...referenceKeys.map((key) => envelope.eventData[key]),
      ].filter(
        (value): value is string => schemas.identifier.safeParse(value).success
      );
      const observation = schemas.observation.parse({
        eventId: envelope.eventId,
        fingerprint: createHash('sha256').update(payload).digest('hex'),
        eventType: envelope.eventType,
        eventCategory: envelope.eventCategory,
        eventDataId: schemas.identifier.safeParse(envelope.eventData.id).success
          ? envelope.eventData.id
          : null,
        envelopeWalletId: envelope.pvb_wallet ?? null,
        sessionId: schemas.identifier.safeParse(envelope.eventData.session_id)
          .success
          ? envelope.eventData.session_id
          : null,
        creditedAt: null,
        status: 'deferred',
        kind: 'unknown',
        providerTransactionId: envelope.pvb_reference ?? null,
        destinationCustomerId: envelope.customer_id,
        sourceWalletId: null,
        destinationWalletId: null,
        reference: null,
        references: [...new Set(references)],
        amountKobo: null,
        feeKobo: null,
        currency: null,
      });
      const initial = await record(observation);
      if (initial === 'conflict') return { outcome: 'conflict' } as const;
      let normalized: ReturnType<typeof schemas.observation.parse> | null;
      try {
        normalized = await normalizePrefundedCardProviderEvidence({
          configuration: settings,
          envelope,
          observation,
          fetchImplementation,
          resolveDestination: async (walletId) => {
            const result = schemas.destinationRows.parse(
              (
                await execute(
                  'SELECT prefunded_card.evidence_destination_mapping($1::uuid,$2::text,$3::text) AS result',
                  [...scope, schemas.identifier.parse(walletId)]
                )
              ).rows
            )[0].result;
            if (result && result.providerWalletId !== walletId)
              throw new Error('Provider evidence destination refused');
            return result;
          },
        });
      } catch {
        return { outcome: 'deferred' } as const;
      }
      if (!normalized) return { outcome: 'deferred' } as const;
      return { outcome: await record(normalized) };
    },
    async verifyTransfer(input: unknown): Promise<Verification> {
      const claim = prefundedCardClaimedRequestSchema.parse(input);
      if (
        claim.integrationId !== settings.integrationId ||
        claim.businessId !== settings.piggyvest.expectedBusinessId
      )
        return { outcome: 'reconciliation_required' };
      const result = schemas.verificationRows.parse(
        (
          await execute(
            'SELECT prefunded_card.read_transfer_evidence($1::uuid,$2::text) AS result',
            [claim.operationId, settings.systemIdentifier]
          )
        ).rows
      )[0].result;
      if (result.outcome !== 'verified_success') return result;
      const evidence = result.evidence;
      if (
        !isDeepStrictEqual(result.request, claim) ||
        evidence.reference !== claim.transferReference ||
        evidence.amountKobo !== claim.amountKobo ||
        evidence.currency !== claim.currency ||
        evidence.businessId !== claim.businessId ||
        evidence.sourceWalletId !== claim.sourceWalletId ||
        evidence.destinationWalletId !== claim.destinationWalletId ||
        evidence.destinationCustomerId !== claim.destinationCustomerId
      )
        return { outcome: 'reconciliation_required' };
      return { outcome: result.outcome, evidence: result.evidence };
    },
    async classifyInflow(eventId: unknown) {
      const selected = schemas.identifier.parse(eventId);
      const result = schemas.classificationRows.parse(
        (
          await execute(
            'SELECT prefunded_card.classify_provider_inflow($1::uuid,$2::text,$3::text) AS result',
            [...scope, selected]
          )
        ).rows
      )[0].result;
      if (
        result.outcome === 'bank_inflow' &&
        (result.eventId !== selected ||
          result.integrationId !== settings.integrationId)
      )
        throw new Error('Provider evidence scope refused');
      return result;
    },
    async applyInflow(eventId: unknown) {
      return schemas.applicationRows.parse(
        (
          await execute(
            'SELECT prefunded_card.apply_classified_inflow($1::uuid,$2::text,$3::text) AS result',
            [...scope, schemas.identifier.parse(eventId)]
          )
        ).rows
      )[0].result;
    },
  };
}
