import 'server-only';
import { isUint8Array } from 'node:util/types';
import { prefundedCardProviderEvidenceSchemas as schemas } from '@/schemas/prefunded-card-provider-evidence';
import { createPrefundedCardProviderEvidence } from './prefunded-card-provider-evidence';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrefundedCardReceiptReplay(options: {
  configuration: unknown;
  ingestionExecute: PiggyvestProvisioningExecutor;
  ledgerExecute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
}) {
  const writer = createPrefundedCardProviderEvidence({
    configuration: options.configuration,
    execute: options.ingestionExecute,
    fetchImplementation: options.fetchImplementation,
  });
  const reader = createPrefundedCardProviderEvidence({
    configuration: options.configuration,
    execute: options.ledgerExecute,
    fetchImplementation: options.fetchImplementation,
  });
  return async (input: { rawPayload: unknown; signature: string | null }) => {
    if (
      !isUint8Array(input.rawPayload) ||
      input.rawPayload.byteLength === 0 ||
      input.rawPayload.byteLength > 65_536
    )
      return { outcome: 'rejected' } as const;
    const rawPayload = Uint8Array.from(input.rawPayload);
    const evidence = await writer.ingest({
      rawPayload,
      signature: input.signature,
    });
    if (
      evidence.outcome === 'invalid_payload' ||
      evidence.outcome === 'invalid_signature'
    )
      return { outcome: 'rejected' } as const;
    if (evidence.outcome === 'conflict')
      return { outcome: 'reconciliation_required' } as const;
    if (evidence.outcome === 'deferred')
      return { outcome: 'retry', stage: 'evidence' } as const;
    const envelope = schemas.envelope.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawPayload))
    );
    if (envelope.eventType === 'wallet-transfer.outflow.success')
      return {
        outcome: 'processed',
        projection: 'not_applicable',
      } as const;
    if (envelope.eventType !== 'bank-transfer.inflow.success')
      return { outcome: 'rejected' } as const;
    const result = await reader.applyInflow(envelope.eventId);
    if (result === 'deferred')
      return { outcome: 'retry', stage: 'projection' } as const;
    if (result === 'reconciliation_required')
      return { outcome: 'reconciliation_required' } as const;
    return { outcome: 'processed', projection: result } as const;
  };
}
