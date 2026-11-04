import { vi } from 'vitest';
import type { ReconciliationPorts } from './daily-reconciliation';

export const GENERATED_AT = '2026-11-03T01:29:30.079678+01:00';
export const NOW = '2026-11-03T00:30:00.000Z';

export function stuck(
  index: number,
  state: 'reserved' | 'dispatched' = 'dispatched'
) {
  const suffix = String(index).padStart(12, '0');
  return {
    operationId: `00000000-0000-4000-8000-${suffix}`,
    goalId: '00000000-0000-4000-8000-0000000000b1',
    state,
    amountKobo: 1000 * index,
    sourceWalletId: 'synthetic-main-wallet',
    destinationWalletId: 'synthetic-goal-b',
    reference: `synthetic-reference-${index}`,
    ageSeconds: 4000 - index,
  };
}

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

export function ports(
  loaded: unknown,
  overrides: Partial<ReconciliationPorts> = {}
): ReconciliationPorts {
  return {
    loadSnapshot: vi.fn(async () => loaded),
    readTransfer: vi.fn(async () => 'pending' as const),
    readWalletBalance: vi.fn(async () => 0),
    now: () => NOW,
    ...overrides,
  };
}
