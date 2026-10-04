const mockValues = new Map<string, string>();
let mockMismatchReadback = false;
const initialUuid = '00000000-0000-4000-8000-000000000009';
let mockUuid = initialUuid;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockMismatchReadback && mockValues.has(key)) {
        mockMismatchReadback = false;
        return null;
      }
      return mockValues.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      mockValues.set(key, value);
    },
    removeItem: async (key: string) => {
      mockValues.delete(key);
    },
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockUuid }));
jest.mock('@/lib/storefront-storage-prefix', () => ({
  getStorefrontStoragePrefix: () => 'test-store:',
}));

import {
  clearTerminalSavingsCardContributionSnapshot,
  readSavingsCardContributionSnapshot,
  saveSavingsCardContributionSnapshot,
} from './savings-card-contribution-snapshot';

const scope = {
  userId: 'customer-1',
  merchantId: 'merchant-1',
  goalId: '00000000-0000-4000-8000-000000000001',
};
const request = {
  goalId: scope.goalId,
  savedMethodId: '00000000-0000-4000-8000-000000000002',
  amountKobo: 15050,
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};

beforeEach(() => {
  mockValues.clear();
  mockMismatchReadback = false;
  mockUuid = initialUuid;
  jest.clearAllMocks();
});

it('serializes concurrent writes per user, merchant, and goal and reuses the same key independent of property order', async () => {
  const testScope = { ...scope, userId: 'customer-concurrent' };
  const [first, second] = await Promise.all([
    saveSavingsCardContributionSnapshot(testScope, request),
    saveSavingsCardContributionSnapshot(testScope, {
      consent: request.consent,
      amountKobo: request.amountKobo,
      savedMethodId: request.savedMethodId,
      goalId: request.goalId,
    }),
  ]);
  expect(first.idempotencyKey).toBe(second.idempotencyKey);
  expect(await readSavingsCardContributionSnapshot(testScope)).toEqual(first);
});

it('refuses changed payloads while an earlier operation is unresolved', async () => {
  const testScope = { ...scope, userId: 'customer-unresolved' };
  await saveSavingsCardContributionSnapshot(testScope, request);
  await expect(
    saveSavingsCardContributionSnapshot(testScope, {
      ...request,
      amountKobo: 20000,
    })
  ).rejects.toThrow(/unresolved/);
});

it('does not replace uncertain persisted data after readback failure', async () => {
  const testScope = { ...scope, userId: 'customer-readback' };
  mockMismatchReadback = true;
  await expect(
    saveSavingsCardContributionSnapshot(testScope, request)
  ).rejects.toThrow(/uncertain/);
  const persisted = await readSavingsCardContributionSnapshot(testScope);
  expect(persisted?.idempotencyKey).toBe(mockUuid);
  await expect(
    saveSavingsCardContributionSnapshot(testScope, {
      ...request,
      amountKobo: 30000,
    })
  ).rejects.toThrow(/uncertain/);
  expect(
    (await readSavingsCardContributionSnapshot(testScope))?.amountKobo
  ).toBe(15050);
});

it('clears a prior key only after explicit confirmed terminal status', async () => {
  const testScope = { ...scope, userId: 'customer-terminal' };
  const saved = await saveSavingsCardContributionSnapshot(testScope, request);
  await expect(
    clearTerminalSavingsCardContributionSnapshot(
      testScope,
      saved.idempotencyKey,
      'reconciliation_required' as never
    )
  ).rejects.toThrow(/terminal/);
  await clearTerminalSavingsCardContributionSnapshot(
    testScope,
    saved.idempotencyKey,
    'completed'
  );
  mockUuid = '00000000-0000-4000-8000-000000000010';
  const next = await saveSavingsCardContributionSnapshot(testScope, {
    ...request,
    amountKobo: 20000,
  });
  expect(next.idempotencyKey).not.toBe(saved.idempotencyKey);
});
