import 'server-only';
import { piggyvestSavingsLedgerSchema } from '@/schemas/piggyvest-savings-ledger';
import { piggyvestSavingsLedgerStoreSchemas as schemas } from '@/schemas/piggyvest-savings-ledger-store';

type LedgerExecutor = (
  text: string,
  values: readonly string[]
) => Promise<{ rows: unknown }>;

export function createSavingsLedger(
  identity: unknown,
  execute: LedgerExecutor
) {
  const parsed = schemas.identity.safeParse(identity);
  if (!parsed.success || typeof execute !== 'function') {
    throw new Error('Internal savings ledger unavailable');
  }
  const { integrationId, merchantId, customerId, goalId } = parsed.data;
  const values = [integrationId, merchantId, customerId, goalId];
  return {
    async apply(input: unknown) {
      try {
        const command = piggyvestSavingsLedgerSchema.parse(input);
        const response = await execute(
          'SELECT piggyvest_savings_ledger.apply($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) AS result',
          [...values, JSON.stringify(command)]
        );
        const result = schemas.acknowledgement.parse(response.rows)[0].result;
        if (
          result.operationId.toLowerCase() !== command.operationId.toLowerCase()
        )
          throw new Error('Mismatched operation');
        return result;
      } catch {
        throw new Error('Internal savings ledger unavailable');
      }
    },
    async snapshot() {
      try {
        const response = await execute(
          'SELECT piggyvest_savings_ledger.snapshot($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result',
          [...values]
        );
        return schemas.snapshot.parse(response.rows)[0].result;
      } catch {
        throw new Error('Internal savings ledger unavailable');
      }
    },
  };
}
