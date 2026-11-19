import 'server-only';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { piggyvestGoalCancelForfeitSchemas as forfeitSchemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as forfeitSql } from './goal-cancel-forfeit-statements';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/** The authorizer-login side of a goal cancel: issue, reserve with PIN, move. */
export function createGoalCancelStore(input: {
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
    // The cancel dispatch: the database splits the provider balance into the
    // principal (customer leg) and the forfeited interest (its own leg).
    async splitDispatch(operationId: string, balanceKobo: number) {
      const result = await input.execute(sql.splitDispatch, [
        scope,
        schemas.operationId.parse(operationId),
        String(forfeitSchemas.splitBalanceKobo.parse(balanceKobo)),
      ]);
      return forfeitSchemas.splitRows.parse(result.rows)[0].result;
    },
    async readAmounts(operationId: string) {
      const result = await input.execute(sql.amounts, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return forfeitSchemas.amountsRows.parse(result.rows)[0].result;
    },
    async claimForfeit(operationId: string) {
      const result = await input.execute(forfeitSql.claim, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return forfeitSchemas.claimRows.parse(result.rows)[0].result;
    },
    async unclaimForfeit(forfeitId: string) {
      const result = await input.execute(forfeitSql.manage, [
        scope,
        schemas.operationId.parse(forfeitId),
        'unclaim',
      ]);
      return forfeitSchemas.unclaimRows.parse(result.rows)[0].result;
    },
    // Records a page about this attempt's hold as emitted (after paging).
    async ackHoldAlert(operationId: string) {
      const result = await input.execute(forfeitSql.holdAck, [
        scope,
        schemas.operationId.parse(operationId),
      ]);
      return forfeitSchemas.ackRows.parse(result.rows)[0].result;
    },
    // Records a page about this forfeit as emitted (call only after paging).
    async ackForfeitAlert(forfeitId: string) {
      const result = await input.execute(forfeitSql.manage, [
        scope,
        schemas.operationId.parse(forfeitId),
        'ack',
      ]);
      return forfeitSchemas.manageAckRows.parse(result.rows)[0].result;
    },
    async markForfeitPosting(forfeitId: string, token: string) {
      const result = await input.execute(forfeitSql.manage, [
        scope,
        schemas.operationId.parse(forfeitId),
        `posting:${schemas.operationId.parse(token)}`,
      ]);
      return forfeitSchemas.postingRows.parse(result.rows)[0].result;
    },
    async releaseForfeit(forfeitId: string) {
      const result = await input.execute(forfeitSql.manage, [
        scope,
        schemas.operationId.parse(forfeitId),
        'release',
      ]);
      return forfeitSchemas.releaseRows.parse(result.rows)[0].result;
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
