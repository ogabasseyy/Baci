import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { GOAL_COMPLETE_STATEMENTS as sql } from './goal-complete-statements';
import { alertGoalPurchaseRequest } from './goal-purchase-request-alert';

vi.mock('server-only', () => ({}));
const alerts = vi.hoisted(() => ({
  log: vi.fn(),
  send: vi.fn(),
}));
vi.mock('./webhook-alerts', () => ({
  logPiggyvestWebhookAlert: alerts.log,
  sendPiggyvestWebhookAlertDelivered: alerts.send,
}));
const execute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-evidence-executor', () => ({
  createPrimaryWalletEvidenceExecutor: () => execute,
}));

const integrationId = '11111111-1111-4111-8111-111111111111';
const operationId = '66666666-6666-4666-8666-666666666666';
const requestId = '77777777-7777-4777-8777-777777777777';
const configuration = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: createHash('sha256').update('s7-alert-db').digest('hex'),
    certificateAuthority: 'test-ca',
  },
};
const pendingRow = { rows: [{ result: { requestId, operationId } }] };

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockReset();
  alerts.log.mockReset();
  alerts.send.mockReset();
  alerts.send.mockResolvedValue(true);
});

it('alerts the owner only after reading the saved request, then marks it sent', async () => {
  const order: string[] = [];
  execute.mockImplementation(async (statement: string) => {
    order.push(statement === sql.readPurchaseAlert ? 'read' : 'mark');
    return statement === sql.readPurchaseAlert
      ? pendingRow
      : { rows: [{ result: true }] };
  });
  alerts.log.mockImplementation(() => order.push('log'));
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'alerted'
  );
  expect(order).toEqual(['read', 'log', 'mark']);
  expect(alerts.log).toHaveBeenCalledWith('PIGGYVEST_GOAL_PURCHASE_REQUEST', {
    operationId,
  });
  expect(execute).toHaveBeenLastCalledWith(sql.markPurchaseAlerted, [
    integrationId,
    'staging',
    operationId,
  ]);
});

it('does nothing when the request was already alerted or does not exist', async () => {
  execute.mockResolvedValue({ rows: [{ result: null }] });
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'none'
  );
  expect(alerts.log).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledOnce();
});

it('keeps the request unalerted and reports pending when the alert cannot be written', async () => {
  execute.mockResolvedValueOnce(pendingRow);
  alerts.log.mockImplementation(() => {
    throw new Error('log sink down');
  });
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'pending'
  );
  expect(execute).toHaveBeenCalledOnce();
});

it('reports pending, never throws, when the request cannot be read or marked', async () => {
  execute.mockRejectedValueOnce(new Error('database unavailable'));
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'pending'
  );
  expect(alerts.log).not.toHaveBeenCalled();
  execute
    .mockResolvedValueOnce(pendingRow)
    .mockRejectedValueOnce(new Error('database unavailable'));
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'pending'
  );
});

it('treats the best-effort PostHog page as optional', async () => {
  execute
    .mockResolvedValueOnce(pendingRow)
    .mockResolvedValueOnce({ rows: [{ result: true }] });
  alerts.send.mockRejectedValue(new Error('posthog down'));
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'alerted'
  );
});

it('refuses a malformed operation id before any statement runs', async () => {
  await expect(
    alertGoalPurchaseRequest({ configuration, operationId: 'nope' })
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it('refuses an unexpected database answer without alerting', async () => {
  execute.mockResolvedValueOnce({
    rows: [{ result: { requestId, operationId, customer: 'x' } }],
  });
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'pending'
  );
  expect(alerts.log).not.toHaveBeenCalled();
});

it('waits for the best-effort PostHog page before returning', async () => {
  execute
    .mockResolvedValueOnce(pendingRow)
    .mockResolvedValueOnce({ rows: [{ result: true }] });
  let settled = false;
  alerts.send.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        setImmediate(() => {
          settled = true;
          resolve(true);
        });
      })
  );
  expect(await alertGoalPurchaseRequest({ configuration, operationId })).toBe(
    'alerted'
  );
  expect(settled).toBe(true);
});
