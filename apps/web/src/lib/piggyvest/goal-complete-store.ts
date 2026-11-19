import 'server-only';
import { piggyvestGoalCompleteSchemas as schemas } from '@/schemas/piggyvest-goal-complete';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { GOAL_COMPLETE_STATEMENTS as sql } from './goal-complete-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/** The authorizer-login side of a goal complete: issue, reserve with PIN, move. */
export function createGoalCompleteStore(input: {
  scope: unknown;
  execute: Execute;
}) {
  const scope = JSON.stringify(
    piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope)
  );

  async function manage(
    operationId: string,
    action: 'dispatch' | 'cancel' | 'cancel_stale' | 'release',
    amountKobo: number | null
  ) {
    const result = await input.execute(sql.manage, [
      scope,
      schemas.operationId.parse(operationId),
      action,
      // Executor parameters are strings. Only dispatch uses the amount (the
      // database refuses a dispatch outside 1..9999999999); other actions
      // send 0, which they ignore.
      amountKobo === null ? '0' : String(schemas.amountKobo.parse(amountKobo)),
    ]);
    return schemas.acknowledgement.parse(result.rows)[0].result;
  }

  return {
    async issue(goalId: string) {
      const result = await input.execute(sql.issue, [
        scope,
        schemas.goalId.parse(goalId),
      ]);
      return schemas.issueRows.parse(result.rows)[0].result;
    },
    // Reserves the attempt and spends the PIN proof in one transaction, so a
    // reservation never exists without a spent proof bound to this attempt.
    async reserve(
      request: { goalId: string; operationId: string },
      pinProof: string
    ) {
      const body = JSON.stringify({
        goalId: schemas.goalId.parse(request.goalId),
        operationId: schemas.operationId.parse(request.operationId),
      });
      const result = await input.execute(sql.reserve, [
        scope,
        body,
        schemas.pinProof.parse(pinProof),
      ]);
      return schemas.reservationRows.parse(result.rows)[0].result;
    },
    // Pre-check for the PIN verify route: true only for a live issued id
    // this database issued for this customer and goal.
    async isLiveIssued(goalId: string, operationId: string) {
      const result = await input.execute(sql.checkIssued, [
        scope,
        schemas.goalId.parse(goalId),
        schemas.operationId.parse(operationId),
      ]);
      return schemas.acknowledgement.parse(result.rows)[0].result;
    },
    async readStatus(operationId: string) {
      const result = await input.execute(sql.status, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return schemas.statusRows.parse(result.rows)[0].result;
    },
    async claimDispatch(operationId: string, amountKobo: number) {
      return await manage(operationId, 'dispatch', amountKobo);
    },
    async cancelBeforeDispatch(operationId: string) {
      return await manage(operationId, 'cancel', null);
    },
    async cancelStaleReservation(operationId: string) {
      return await manage(operationId, 'cancel_stale', null);
    },
    async releaseAfterRejection(operationId: string) {
      return await manage(operationId, 'release', null);
    },
  };
}
