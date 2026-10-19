import 'server-only';
import { prefundedCardOperationInputSchemas as inputs } from '@/schemas/prefunded-card-operation-store';
import { prefundedCardRuntimeSchemas as runtime } from '@/schemas/prefunded-card-runtime';
import { prefundedCardOperationStoreSchemas as schemas } from '@/schemas/prefunded-card-storage';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export function createPrefundedCardOperationStore(execute: Execute) {
  if (typeof execute !== 'function')
    throw new Error('Prefunded card store unavailable');
  return {
    async readOperation(operationId: unknown, systemIdentifier: unknown) {
      try {
        const expectedId = schemas.uuid.parse(operationId);
        const response = await execute(
          'SELECT prefunded_card.read_operation($1::uuid,$2::text) AS result',
          [expectedId, runtime.systemIdentifier.parse(systemIdentifier)]
        );
        const result = runtime.readRows.parse(response.rows)[0].result;
        if (result.operationId !== expectedId)
          throw new Error('Mismatched operation');
        return result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async project(operationId: unknown, systemIdentifier: unknown) {
      try {
        const response = await execute(
          'SELECT prefunded_card.project($1::uuid,$2::text) AS result',
          [
            schemas.uuid.parse(operationId),
            runtime.systemIdentifier.parse(systemIdentifier),
          ]
        );
        return runtime.projectionRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async reserve(command: unknown) {
      try {
        const parsed = schemas.command.parse(command);
        const response = await execute(
          'SELECT prefunded_card.reserve($1::jsonb) AS result',
          [JSON.stringify(parsed)]
        );
        const result = schemas.reservationRows.parse(response.rows)[0].result;
        if (result.operationId !== parsed.operationId)
          throw new Error('Mismatched reservation');
        return result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async claimCollection(operationId: unknown, fence: unknown) {
      try {
        const expectedId = schemas.uuid.parse(operationId);
        const expectedFence = schemas.claimFence.parse(fence);
        const response = await execute(
          'SELECT prefunded_card.claim_collection($1::uuid,$2::bigint) AS result',
          [
            schemas.uuid.parse(operationId),
            schemas.claimFence.parse(fence).toString(),
          ]
        );
        const result = schemas.claimRows.parse(response.rows)[0].result;
        if (
          result.outcome === 'claimed' &&
          (result.operationId !== expectedId ||
            result.request.operationId !== expectedId ||
            result.fence !== expectedFence + 1)
        )
          throw new Error('Mismatched collection claim');
        return result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async recordCollection(
      operationId: unknown,
      fence: unknown,
      outcome: unknown,
      evidence: unknown
    ) {
      try {
        const response = await execute(
          'SELECT prefunded_card.record_collection($1::uuid,$2::bigint,$3::text,$4::jsonb) AS result',
          [
            schemas.uuid.parse(operationId),
            schemas.commitFence.parse(fence).toString(),
            inputs.collectionOutcome.parse(outcome),
            JSON.stringify(inputs.evidence.nullable().parse(evidence)),
          ]
        );
        return schemas.collectionResultRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async claimTransfer(operationId: unknown, fence: unknown) {
      try {
        const expectedId = schemas.uuid.parse(operationId);
        const expectedFence = schemas.claimFence.parse(fence);
        const response = await execute(
          'SELECT prefunded_card.claim_transfer($1::uuid,$2::bigint) AS result',
          [
            schemas.uuid.parse(operationId),
            schemas.claimFence.parse(fence).toString(),
          ]
        );
        const result = schemas.claimRows.parse(response.rows)[0].result;
        if (
          result.outcome === 'claimed' &&
          (result.operationId !== expectedId ||
            result.request.operationId !== expectedId ||
            result.fence !== expectedFence + 1)
        )
          throw new Error('Mismatched transfer claim');
        return result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async recordTransfer(
      operationId: unknown,
      fence: unknown,
      outcome: unknown,
      evidence: unknown
    ) {
      try {
        const response = await execute(
          'SELECT prefunded_card.record_transfer($1::uuid,$2::bigint,$3::text,$4::jsonb) AS result',
          [
            schemas.uuid.parse(operationId),
            schemas.commitFence.parse(fence).toString(),
            inputs.transferOutcome.parse(outcome),
            JSON.stringify(inputs.evidence.nullable().parse(evidence)),
          ]
        );
        return schemas.transferResultRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async claimReconciliation(operationId: unknown, leaseSeconds: unknown) {
      try {
        const response = await execute(
          'SELECT prefunded_card.claim_reconciliation($1::uuid,$2::integer) AS result',
          [
            schemas.uuid.parse(operationId),
            inputs.leaseSeconds.parse(leaseSeconds).toString(),
          ]
        );
        const result = schemas.reconciliationRows.parse(response.rows)[0]
          .result;
        if (
          result.outcome === 'verify_only' &&
          (result.operationId !== schemas.uuid.parse(operationId) ||
            result.request.operationId !== result.operationId)
        )
          throw new Error('Mismatched verification claim');
        return result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
    async completeReconciliation(
      operationId: unknown,
      token: unknown,
      fence: unknown,
      leg: unknown,
      outcome: unknown,
      evidence: unknown
    ) {
      try {
        const response = await execute(
          'SELECT prefunded_card.complete_reconciliation($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::jsonb) AS result',
          [
            schemas.uuid.parse(operationId),
            schemas.uuid.parse(token),
            schemas.commitFence.parse(fence).toString(),
            inputs.reconciliationLeg.parse(leg),
            inputs.reconciliationOutcome.parse(outcome),
            JSON.stringify(inputs.evidence.parse(evidence)),
          ]
        );
        return schemas.reconciliationCompletionRows.parse(response.rows)[0]
          .result;
      } catch {
        throw new Error('Prefunded card store unavailable');
      }
    },
  };
}
