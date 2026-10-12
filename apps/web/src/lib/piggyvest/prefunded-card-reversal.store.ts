import 'server-only';
import { prefundedCardReversalSchemas as schemas } from '@/schemas/prefunded-card-reversal';
import { prefundedCardRuntimeSchemas } from '@/schemas/prefunded-card-runtime';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export function createPrefundedCardReversalStore(
  execute: Execute,
  expectedSystemId: unknown
) {
  const system =
    prefundedCardRuntimeSchemas.systemIdentifier.parse(expectedSystemId);
  return {
    async readContext(operationId: unknown) {
      try {
        const expectedId = schemas.uuid.parse(operationId);
        const response = await execute(
          'SELECT prefunded_card.read_reversal_context($1::uuid,$2::text) AS result',
          [expectedId, system]
        );
        const context = schemas.contextRows.parse(response.rows)[0].result;
        if (context.request.operationId !== expectedId)
          throw new Error('Mismatched operation');
        return context;
      } catch {
        throw new Error('Prefunded reversal unavailable');
      }
    },
    async recordReversal(input: unknown) {
      try {
        const command = schemas.command.parse(input);
        const response = await execute(
          'SELECT prefunded_card.record_collection_reversal($1::text,$2::jsonb) AS result',
          [system, JSON.stringify(command)]
        );
        const receipt = schemas.receiptRows.parse(response.rows)[0].result;
        if (
          receipt.operationId !== command.operationId ||
          receipt.eventId !== command.eventId
        )
          throw new Error('Mismatched reversal');
        return receipt;
      } catch {
        throw new Error('Prefunded reversal unavailable');
      }
    },
  };
}
