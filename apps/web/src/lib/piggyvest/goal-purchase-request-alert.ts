import 'server-only';
import { piggyvestGoalCompleteSchemas as schemas } from '@/schemas/piggyvest-goal-complete';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { GOAL_COMPLETE_STATEMENTS as sql } from './goal-complete-statements';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import {
  logPiggyvestWebhookAlert,
  sendPiggyvestWebhookAlertDelivered,
} from './webhook-alerts';

/**
 * Alerts the owner that a customer completed a goal and wants to buy.
 *
 * The purchase request row was saved by the settlement transaction, so this
 * runs strictly after the request is durable: it reads the saved, unalerted
 * request first and alerts only if the database returned one. The alert line
 * is the primary page (the log drain routes on it); the request is marked
 * alerted only after the line is written, and the PostHog page is a best
 * effort extra. Any failure leaves the request unalerted, so the next status
 * check alerts again, and the operator list shows it either way. Nothing here
 * throws for a database or alert problem: completing a goal never fails
 * because an alert did.
 */
export async function alertGoalPurchaseRequest(input: {
  configuration: unknown;
  operationId: string;
}): Promise<'alerted' | 'none' | 'pending'> {
  const operationId = schemas.operationId.parse(input.operationId);
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const execute = createPrimaryWalletEvidenceExecutor(configuration);
  const parameters = [
    configuration.integrationId,
    configuration.environment,
    operationId,
  ];
  try {
    const read = await execute(sql.readPurchaseAlert, parameters);
    const row: unknown = Array.isArray(read.rows) ? read.rows[0] : undefined;
    const result =
      row !== null && typeof row === 'object' && 'result' in row
        ? row.result
        : undefined;
    if (result === null) return 'none';
    const request = schemas.purchaseAlert.parse(result);
    if (request.operationId !== operationId) return 'pending';
    logPiggyvestWebhookAlert('PIGGYVEST_GOAL_PURCHASE_REQUEST', {
      operationId,
    });
    await execute(sql.markPurchaseAlerted, parameters);
    // Extra channel only; its outcome never changes the answer. It is awaited
    // so a serverless runtime cannot freeze before the request is sent.
    await sendPiggyvestWebhookAlertDelivered(
      'PIGGYVEST_GOAL_PURCHASE_REQUEST',
      {
        operationId,
      }
    ).catch(() => undefined);
    return 'alerted';
  } catch {
    return 'pending';
  }
}
