import 'server-only';
import { createHash } from 'node:crypto';
import { isUint8Array } from 'node:util/types';
import { savingsExitEvidenceSchemas as schemas } from '@/schemas/savings-exit-evidence';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { SAVINGS_EXIT_EVIDENCE_STATEMENTS as statements } from './savings-exit-evidence-statements';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

const STAGING_ORIGIN = 'https://staging.piggyvest.business';
const MAX_BYTES = 65536;
const TIMEOUT_MS = 5000;

export function createSavingsExitEvidence(options: {
  configuration: unknown;
  execute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
}) {
  const configuration = schemas.configuration.parse(options.configuration);
  function read(endpoint: string): Promise<unknown> {
    return requestPrefundedCardProviderJson({
      url: `${STAGING_ORIGIN}${endpoint}`,
      token: configuration.apiSecret,
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_BYTES,
      fetchImplementation: options.fetchImplementation,
      init: { method: 'GET' },
    });
  }
  return {
    async ingest(input: { rawPayload: Uint8Array; signature: string | null }) {
      if (
        !isUint8Array(input.rawPayload) ||
        input.rawPayload.byteLength > MAX_BYTES
      )
        return { state: 'deferred' as const };
      const bytes = Uint8Array.from(input.rawPayload);
      if (
        !verifyPiggyvestPayloadSignature({
          payload: bytes,
          signature: input.signature,
          secret: configuration.webhookSecret,
        })
      )
        return { state: 'invalid_signature' as const };
      try {
        const event = schemas.envelope.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        );
        const transaction = schemas.transaction.parse(
          await read(
            `/api/v1/transaction/${encodeURIComponent(event.pvb_reference)}?wallet_id=${encodeURIComponent(event.pvb_wallet)}`
          )
        ).data;
        if (
          transaction.id !== event.pvb_reference ||
          transaction.source_wallet !== event.pvb_wallet ||
          transaction.customer_id !== event.customer_id ||
          transaction.source_wallet === transaction.destination_wallet
        )
          return { state: 'deferred' as const };
        const tsq = schemas.tsq.parse(
          await read(
            `/api/v1/transaction/verify?reference=${encodeURIComponent(transaction.reference)}&wallet_id=${encodeURIComponent(transaction.source_wallet)}`
          )
        ).data;
        if (
          tsq.reference !== transaction.reference ||
          tsq.amount !== transaction.amount
        )
          return { state: 'deferred' as const };
        const sourceWallet = schemas.wallet.parse(
          await read(
            `/api/v1/wallet/${encodeURIComponent(transaction.source_wallet)}`
          )
        ).data;
        const destinationWallet = schemas.wallet.parse(
          await read(
            `/api/v1/wallet/${encodeURIComponent(transaction.destination_wallet)}`
          )
        ).data;
        if (
          sourceWallet.id !== transaction.source_wallet ||
          destinationWallet.id !== transaction.destination_wallet ||
          sourceWallet.business_id !== configuration.expectedBusinessId ||
          destinationWallet.business_id !== sourceWallet.business_id ||
          destinationWallet.currency !== sourceWallet.currency
        )
          return { state: 'deferred' as const };
        const receipt = schemas.receipt.parse({
          eventId: event.eventId,
          providerTransactionId: transaction.id,
          providerCustomerId: transaction.customer_id,
          reference: transaction.reference,
          sourceWalletId: transaction.source_wallet,
          destinationWalletId: transaction.destination_wallet,
          businessId: sourceWallet.business_id,
          currency: sourceWallet.currency,
          amountKobo: transaction.amount,
          feeKobo: transaction.fee,
          payloadSha256: createHash('sha256').update(bytes).digest('hex'),
        });
        return schemas.storedRows.parse(
          (
            await options.execute(statements.exitRecordEvidence.text, [
              configuration.integrationId,
              JSON.stringify(receipt),
            ])
          ).rows
        )[0].result;
      } catch {
        return { state: 'deferred' as const };
      }
    },
  };
}
