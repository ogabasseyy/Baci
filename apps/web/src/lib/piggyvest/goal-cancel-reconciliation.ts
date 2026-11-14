import { readConflictAnswer } from './goal-cancel-conflict-answer';
import 'server-only';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { GOAL_CANCEL_STATEMENTS as sql } from './goal-cancel-statements';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';
import { retrievePiggyvestWallet } from './wallets';
import {
  emitPiggyvestWebhookAlert,
  type PiggyvestWebhookAlertCode,
} from './webhook-alerts';

/** The goal wallet the post-transfer balance read must be about. */
export interface GoalBalanceTarget {
  walletId: string;
  businessId: string;
  // Known once the dispatched attempt has been loaded; absent fails closed.
  providerCustomerId: string | undefined;
}

/**
 * PiggyVest answered, but about a different wallet than the one asked for. A
 * balance from it must never decide whether the goal settles at zero.
 */
export class GoalBalanceMismatchError extends Error {
  constructor() {
    super('Goal wallet balance read does not match the requested wallet');
    this.name = 'GoalBalanceMismatchError';
  }
}

/** The four evidence statements a goal cancel or goal complete settles with. */
export type GoalEvidenceStatements = Readonly<
  Record<'readDispatched' | 'findByReference' | 'settle' | 'release', string>
> & {
  // Optional: records an emitted page so the forfeit sweep does not repeat it.
  readonly ack?: string;
};

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

/**
 * The evidence-login side of a goal cancel: read the dispatched attempt, then
 * settle or release it from a verified provider record. It carries no
 * dispatch handle, so it can only conclude what the provider already did.
 */
export function createGoalCancelEvidenceStore(input: {
  integrationId: string;
  environment: 'staging' | 'production';
  execute: Execute;
  // Cancel by default; goal complete passes its own statements and alert code.
  statements?: GoalEvidenceStatements;
  alertCode?: PiggyvestWebhookAlertCode;
  // Re-reads the goal wallet balance at PiggyVest (kobo) once a transfer is
  // verified successful. Anything above 0 means money is still there (a
  // credit landed between the snapshot and the transfer).
  readGoalBalanceKobo?: (target: GoalBalanceTarget) => Promise<number>;
}) {
  // The provider customer of each loaded attempt, so the balance read can be
  // bound to the customer as well as to the wallet and business.
  const providerCustomers = new Map<string, string>();
  const statements: GoalEvidenceStatements = input.statements ?? sql;
  const alertCode = input.alertCode ?? 'PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW';
  async function run(statement: string, selection: string) {
    const result = await input.execute(statement, [
      input.integrationId,
      input.environment,
      selection,
    ]);
    if (!Array.isArray(result.rows) || result.rows.length !== 1)
      throw new Error('Goal cancel settlement unavailable');
    const row: unknown = result.rows[0];
    if (row === null || typeof row !== 'object' || !('result' in row))
      throw new Error('Goal cancel settlement unavailable');
    return row.result;
  }
  // A conflict means PiggyVest answered but our books refused the conclusion
  // (for example a late success while a newer attempt is live). The money may
  // have moved, so a person is paged and the status path is told.
  let conflicted = false;
  async function flagConflict(
    reason: string,
    proof: object,
    // Other rows this one page covers (a forfeit replacement that went to
    // review as its own row, or replacements a late success froze).
    reviewedIds: readonly string[] = []
  ) {
    conflicted = true;
    const { operationId } = proof as { operationId?: unknown };
    emitPiggyvestWebhookAlert(alertCode, {
      reason,
      ...(typeof operationId === 'string' ? { operationId } : {}),
    });
    // Acknowledged only after the page; a failure just means it repeats.
    const acknowledged = [
      ...(typeof operationId === 'string' ? [operationId] : []),
      ...reviewedIds,
    ];
    if (statements.ack)
      for (const id of acknowledged)
        await run(statements.ack, id).catch(() => undefined);
  }
  // Reads the goal wallet balance left after a verified transfer. A transient
  // failure (network, provider jitter) is NOT a settlement conflict: it is
  // rethrown without paging, nothing is concluded, and the next status check
  // retries. Only a read that answers about the wrong wallet is a verified
  // mismatch, and that pages.
  async function readResidual(receipt: Record<string, unknown>) {
    if (!input.readGoalBalanceKobo) return 0;
    const operationId = String(receipt.operationId);
    try {
      const residual = await input.readGoalBalanceKobo({
        walletId: String(receipt.sourceWalletId),
        businessId: String(receipt.businessId),
        providerCustomerId: providerCustomers.get(operationId),
      });
      return Number.isSafeInteger(residual) && residual > 0 ? residual : 0;
    } catch (error) {
      if (error instanceof GoalBalanceMismatchError)
        await flagConflict('settle_balance_mismatch', receipt);
      throw error;
    }
  }
  // Concludes a verified provider record. PiggyVest has already answered, so
  // a database failure here (a raise inside the settle function, a malformed
  // answer) is not a plain wait: a person is paged and the status path reports
  // needs-review. The error is rethrown, so nothing is concluded and the next
  // status check retries from the stored attempt.
  async function conclude<T extends string>(
    statement: string,
    proof: object,
    allowed: readonly T[],
    kind: 'settle' | 'release'
  ): Promise<T> {
    const { status: _status, ...receipt } = proof as Record<string, unknown>;
    // Only a settlement carries the residual: the database never settles a
    // goal as cancelled-at-zero while the provider wallet still holds money,
    // and never sends a second transfer. The value can only make the
    // database stricter (review), never looser.
    let body: Record<string, unknown> = receipt;
    if (kind === 'settle') {
      const residual = await readResidual(receipt);
      if (residual > 0) body = { ...receipt, residualKobo: residual };
    }
    let result: unknown;
    let reviewedIds: readonly string[] = [];
    try {
      result = await run(statement, JSON.stringify(body));
      ({ result, reviewedIds } = readConflictAnswer(result));
      if (!allowed.includes(result as T))
        throw new Error('Goal cancel settlement unavailable');
    } catch (error) {
      await flagConflict(`${kind}_failed`, receipt);
      throw error;
    }
    if (result === 'conflict')
      await flagConflict(`${kind}_conflict`, receipt, reviewedIds);
    return result as T;
  }
  return {
    hasConflict: () => conflicted,
    async loadDispatched(operationId: string) {
      const result = await run(
        statements.readDispatched,
        schemas.operationId.parse(operationId)
      );
      if (result === null) return null;
      const reservation = schemas.dispatchedReservation.parse(result);
      providerCustomers.set(
        reservation.operationId,
        reservation.providerCustomerId
      );
      return reservation;
    },
    // Webhook path: the attempt (dispatched, or released after dispatch)
    // whose provider reference an outflow event names, or null.
    async findByReference(reference: string) {
      const result = await run(statements.findByReference, reference);
      return result === null ? null : schemas.referenceMatch.parse(result);
    },
    settle: (proof: object) =>
      conclude<'confirmed' | 'duplicate' | 'conflict'>(
        statements.settle,
        proof,
        ['confirmed', 'duplicate', 'conflict'],
        'settle'
      ),
    release: (proof: object) =>
      conclude<'released' | 'duplicate' | 'conflict'>(
        statements.release,
        proof,
        ['released', 'duplicate', 'conflict'],
        'release'
      ),
  };
}

export function goalBalanceReader(environment: unknown, token: string) {
  return async (target: GoalBalanceTarget) => {
    const wallet = await retrievePiggyvestWallet(
      { token, baseUrl: getPrimaryWalletProviderOrigin(environment) },
      target.walletId
    );
    const read = schemas.wallet.parse(wallet);
    if (
      read.id !== target.walletId ||
      read.business_id !== target.businessId ||
      target.providerCustomerId === undefined ||
      read.api_customer_id !== target.providerCustomerId
    )
      throw new GoalBalanceMismatchError();
    return read.balance;
  };
}

/**
 * Webhook-driven reconciliation of goal cancels: resolve each reference to a
 * dispatched (or dispatched-then-released) cancel and run the same proof the
 * client status path runs, so a cancel whose customer closed the app still
 * settles. Returns 'unmatched' when no reference names a goal cancel.
 */
export async function runGoalCancelOutflowReconciliation(input: {
  configuration: unknown;
  providerToken: unknown;
  references: readonly string[];
  fetchImplementation?: typeof fetch;
}): Promise<'confirmed' | 'cancelled' | 'pending' | 'unmatched'> {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createGoalCancelEvidenceStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
    readGoalBalanceKobo: goalBalanceReader(configuration.environment, token),
  });
  for (const reference of input.references) {
    if (!schemas.reference.safeParse(reference).success) continue;
    const match = await store.findByReference(reference);
    if (!match) continue;
    const outcome = await reconcilePrimaryWalletSavings(match.operationId, {
      ...store,
      queryProvider: createSavingsVerifyQueryProvider({
        environment: configuration.environment,
        token,
        fetchImplementation: input.fetchImplementation,
      }),
    });
    return outcome.status;
  }
  return 'unmatched';
}

/**
 * Re-queries the provider for the dispatched cancel and settles it (success)
 * or releases it (provider-reported failure). Anything else, including a 404
 * right after the submit, stays pending: nothing is resent or released.
 */
export async function runGoalCancelReconciliation(input: {
  configuration: unknown;
  providerToken: unknown;
  operationId: unknown;
  fetchImplementation?: typeof fetch;
}) {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createGoalCancelEvidenceStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
    readGoalBalanceKobo: goalBalanceReader(configuration.environment, token),
  });
  const outcome = await reconcilePrimaryWalletSavings(input.operationId, {
    ...store,
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token,
      fetchImplementation: input.fetchImplementation,
    }),
  });
  return { ...outcome, needsReview: store.hasConflict() };
}
