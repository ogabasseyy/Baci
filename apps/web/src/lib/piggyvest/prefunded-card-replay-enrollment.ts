import 'server-only';
import { createHash } from 'node:crypto';
import { isUint8Array } from 'node:util/types';
import { prefundedCardReplayEnrollmentSchemas as schemas } from '@/schemas/prefunded-card-replay-enrollment';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS } from './prefunded-card-postgres-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrefundedCardReplayEnrollment(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const parsed = schemas.configuration.safeParse(options.configuration);
  if (!parsed.success || typeof options.execute !== 'function')
    throw new Error('Prefunded enrollment unavailable');
  const { scope, databaseName } = parsed.data;
  const execute = options.execute;
  return async (
    input: unknown
  ): Promise<'enrolled' | 'legacy' | 'deferred'> => {
    try {
      const request = schemas.input.parse(input);
      if (
        !isUint8Array(request.rawPayload) ||
        request.rawPayload.byteLength === 0 ||
        request.rawPayload.byteLength > 65_536
      )
        return 'deferred';
      const rawPayload = Uint8Array.from(request.rawPayload);
      if (
        createHash('sha256').update(rawPayload).digest('hex') !==
        request.payloadSha256
      )
        return 'deferred';
      const envelope = schemas.envelope.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawPayload))
      );
      const bank = envelope.eventType === 'bank-transfer.inflow.success';
      const inner = envelope.eventData;
      if (
        envelope.eventId !== request.eventId ||
        envelope.eventType !== request.eventType ||
        envelope.customer_id !== request.providerCustomerId ||
        (bank &&
          (inner.customer_id === undefined ||
            inner.destination_wallet_id === undefined)) ||
        (inner.customer_id !== undefined &&
          inner.customer_id !== envelope.customer_id) ||
        (envelope.pvb_destination_wallet !== undefined &&
          inner.destination_wallet_id !== undefined &&
          envelope.pvb_destination_wallet !== inner.destination_wallet_id &&
          (!bank || envelope.pvb_destination_wallet !== envelope.pvb_wallet)) ||
        (bank
          ? !['bank-transfer', 'inflow_transaction'].includes(
              envelope.eventCategory
            )
          : envelope.eventCategory !== 'wallet-transfer')
      )
        return 'deferred';
      const references = [
        envelope.pvb_reference,
        envelope.pvb_third_party_reference,
        inner.id,
        inner.transaction_id,
        inner.reference,
        inner.third_party_reference,
        inner.internal_reference,
        inner.initiator_reference,
        inner.session_id,
      ].filter((value): value is string => value !== undefined);
      const hints = schemas.hints.parse({
        eventType: envelope.eventType,
        envelopeWalletId: envelope.pvb_wallet,
        envelopeCustomerId: envelope.customer_id,
        destinationWalletId: inner.destination_wallet_id ?? null,
        innerCustomerId: inner.customer_id ?? null,
        sourceWalletId: inner.source_wallet_id || null,
        declaredDestinationWalletId: envelope.pvb_destination_wallet ?? null,
        references: [...new Set(references)],
      });
      return schemas.rows.parse(
        (
          await execute(
            PREFUNDED_CARD_POSTGRES_STATEMENTS.resolveReplayEnrollment.text,
            [
              scope.integrationId,
              scope.merchantId,
              scope.treasuryBindingId,
              scope.businessId,
              databaseName,
              scope.expectedSystemId,
              schemas.serializedHints.parse(JSON.stringify(hints)),
            ]
          )
        ).rows
      )[0].result;
    } catch {
      return 'deferred';
    }
  };
}
