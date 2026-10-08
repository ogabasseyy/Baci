import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export function createPrimaryWalletSavingsStore(input: {
  scope: unknown;
  execute: Execute;
}) {
  const scope = JSON.stringify(
    piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope)
  );

  async function manage(operationId: string, action: 'dispatch' | 'cancel') {
    const parsed = schemas.request.shape.operationId.parse(operationId);
    const result = await input.execute(
      'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result',
      [scope, parsed, action]
    );
    return schemas.acknowledgement.parse(result.rows)[0].result;
  }

  return {
    async recoverPending(goalId: string) {
      const parsed = schemas.request.shape.goalId.parse(goalId);
      const result = await input.execute(
        'SELECT piggyvest_primary.read_pending_savings($1::jsonb,$2::uuid) AS result',
        [scope, parsed]
      );
      const operation = schemas.recoveryRows.parse(result.rows)[0].result;
      if (operation && operation.goalId !== parsed)
        throw new Error('Savings recovery binding unavailable');
      return operation;
    },
    async readStatus(operationId: string) {
      const parsed = schemas.request.shape.operationId.parse(operationId);
      const result = await input.execute(
        'SELECT piggyvest_primary.read_savings_status($1::jsonb,$2::uuid) AS result',
        [scope, parsed]
      );
      return schemas.statusRows.parse(result.rows)[0].result;
    },
    async reserve(request: unknown) {
      const parsed = schemas.request.parse(request);
      const result = await input.execute(
        'SELECT piggyvest_primary.reserve_savings($1::jsonb,$2::jsonb) AS result',
        [scope, JSON.stringify(parsed)]
      );
      const rows = schemas.reservationRows.parse(result.rows);
      return rows[0].result;
    },
    async claimDispatch(operationId: string) {
      return await manage(operationId, 'dispatch');
    },
    async cancelBeforeDispatch(operationId: string) {
      if (!(await manage(operationId, 'cancel')))
        throw new Error('Savings hold could not be released');
    },
  };
}
