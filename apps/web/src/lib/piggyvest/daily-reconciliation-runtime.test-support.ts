import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { DailyReconciliationDeps } from './daily-reconciliation-runtime';

const digest = (label: string) =>
  createHash('sha256').update(label).digest('hex');
export const INTEGRATION = '00000000-0000-4000-8000-000000000001';
const GENERATED_AT = '2026-11-03T01:29:30.079678+01:00';

export const env = {
  PIGGYVEST_RECONCILIATION_ENABLED: 'true',
  PIGGYVEST_RECONCILIATION_REPORT_EMAIL: 'owner@example.test',
} as unknown as NodeJS.ProcessEnv;

export const runtime = {
  configuration: { integrationId: INTEGRATION, environment: 'staging' },
  reconciliationConfiguration: {
    integrationId: INTEGRATION,
    environment: 'staging',
  },
  businessId: 'synthetic-business',
  providerToken: digest('provider-token'),
  merchantId: '00000000-0000-4000-8000-000000000002',
};

export function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: GENERATED_AT,
    staleAfterSeconds: 1800,
    businessId: 'synthetic-business',
    stuck: [],
    stuckTotal: 0,
    stuckDeferred: 0,
    wallets: [],
    walletsTotal: 0,
    walletsDeferred: 0,
    ...overrides,
  };
}

/** An empty credit-gap ledger read (no mapped plan wallets). */
export function ledger(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: GENERATED_AT,
    windowStart: '2026-10-31T00:29:30.079678+00:00',
    businessId: 'synthetic-business',
    wallets: [],
    walletsTotal: 0,
    walletsDeferred: 0,
    ...overrides,
  };
}

/** Wallet pay part of the report with nothing outstanding. */
export const NO_WALLET_PAY_WORK = {
  stuckPayments: [],
  undelivered: [],
  unrefunded: [],
  needsReview: [],
};

/**
 * Answers each statement with its own result: the snapshot, the ledger, or
 * the wallet pay report (nothing outstanding unless given).
 */
export function executeWith(
  snapshotResult: unknown = snapshot(),
  ledgerResult: unknown = ledger(),
  walletPayResult: unknown = NO_WALLET_PAY_WORK
) {
  return vi.fn(async (statement?: string) => ({
    rows: [
      {
        result: statement?.includes('read_credit_gap_ledger')
          ? ledgerResult
          : statement?.includes('read_wallet_pay_reconciliation')
            ? walletPayResult
            : snapshotResult,
      },
    ],
  }));
}

export function makeDeps(overrides: Partial<DailyReconciliationDeps> = {}) {
  const execute = executeWith();
  const deps: DailyReconciliationDeps = {
    readRuntime: vi.fn(() => runtime) as never,
    createExecutor: vi.fn(() => execute) as never,
    readProviderTransfer: vi.fn(async () => ({
      outcome: 'pending' as const,
    })) as never,
    retrieveWallet: vi.fn(async (_c: unknown, id: string) => ({
      id,
      business_id: 'synthetic-business',
      balance: 0,
    })) as never,
    createWalletPageReader: vi.fn(() =>
      vi.fn(async () => ({
        status: true,
        data: {
          edges: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
            previousCursor: null,
          },
        },
      }))
    ),
    sendEmail: vi.fn(async () => ({ success: true })),
    emitAlert: vi.fn(),
    now: () => '2026-11-03T00:30:00.000Z',
    nowMs: () => 0,
    ...overrides,
  };
  return { deps, execute };
}
