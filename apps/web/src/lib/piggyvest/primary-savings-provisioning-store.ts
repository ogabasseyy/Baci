import 'server-only';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export const PRIMARY_SAVINGS_PROVISIONING_STATEMENTS = {
  prepare:
    'SELECT piggyvest_primary.prepare_goal_wallet($1::jsonb,$2::uuid,$3::boolean) AS result',
  read: 'SELECT piggyvest_primary.read_goal_wallet($1::jsonb,$2::uuid) AS result',
  record:
    'SELECT piggyvest_primary.record_goal_wallet($1::jsonb,$2::uuid,$3::uuid,$4::text) AS result',
  enroll:
    'SELECT piggyvest_primary.enroll_goal_wallet($1::jsonb,$2::uuid,$3::jsonb) AS result',
};

export function createPrimarySavingsProvisioningStore(input: {
  scope: unknown;
  execute: PiggyvestProvisioningExecutor;
}) {
  const scope = JSON.stringify(schemas.scope.parse(input.scope));
  async function read(goalId: string, statement: string) {
    const result = await input.execute(statement, [
      scope,
      schemas.goalId.parse(goalId),
    ]);
    return schemas.rows.parse(result.rows)[0].result;
  }
  return {
    async prepare(goalId: string, interestAccepted: boolean) {
      const response = await input.execute(
        PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.prepare,
        [
          scope,
          schemas.goalId.parse(goalId),
          String(schemas.interestAccepted.parse(interestAccepted)),
        ]
      );
      return schemas.rows.parse(response.rows)[0].result;
    },
    read: (goalId: string) =>
      read(goalId, PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.read),
    async record(goalId: string, claimToken: string, walletId: string | null) {
      const result = await input.execute(
        PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.record,
        [
          scope,
          schemas.goalId.parse(goalId),
          schemas.claimToken.parse(claimToken),
          walletId === null ? null : schemas.providerId.parse(walletId),
        ]
      );
      return schemas.acknowledgement.parse(result.rows)[0].result;
    },
    async enroll(goalId: string, proof: unknown) {
      const result = await input.execute(
        PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.enroll,
        [
          scope,
          schemas.goalId.parse(goalId),
          JSON.stringify(schemas.proof.parse(proof)),
        ]
      );
      return schemas.acknowledgement.parse(result.rows)[0].result;
    },
  };
}
