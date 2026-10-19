import { describe, expect, it, vi } from 'vitest';
import { createGoalPolicyStore } from './goal-policy-store';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';

vi.mock('server-only', () => ({}));

const scope = {
  environment: 'staging',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
};
const actorId = '90000000-0000-4000-8000-000000000001';
function connection(role = 'piggyvest_staging_policy_writer') {
  return {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    port: 55443,
    role,
  };
}
function command(sequence: number) {
  return {
    revisionId: `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
    productId: '50000000-0000-4000-8000-000000000001',
    variantId: '60000000-0000-4000-8000-000000000001',
    termsVersion: 'synthetic-runtime-v1',
    termsHash: 'a'.repeat(64),
    quoteId: `synthetic-runtime-quote-${sequence}`,
    quoteKobo: 100000,
    quoteExpiresAt: '2099-01-01T00:00:00Z',
    guarantee: null,
    lifecycle: 'draft',
    collectionPaused: true,
  };
}
function store(sequence: number, overrides: Partial<typeof scope> = {}) {
  return createGoalPolicyStore({
    configuration: {
      ...scope,
      goalId: `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      ...overrides,
    },
    execute: createPiggyvestPostgresExecutor(connection()),
  });
}

describe.skipIf(
  process.env.PIGGYVEST_RUN_LOCAL_POSTGRES !== '1' ||
    process.env.PIGGYVEST_RUN_GOAL_POLICY_RUNTIME !== '1'
)('goal policy store through real restricted PostgreSQL executor', () => {
  it('commits stage and acceptance across connections and replays one immutable receipt', async () => {
    const input = command(101);
    await expect(store(101).read()).resolves.toBeNull();
    await expect(store(101).stage(input)).resolves.toEqual({
      revisionId: input.revisionId,
      outcome: 'staged',
    });
    await expect(store(101).stage(input)).resolves.toEqual({
      revisionId: input.revisionId,
      outcome: 'staged',
    });
    expect(await store(101).read()).toMatchObject({
      command: input,
      actorId: null,
      acceptedAt: null,
      device: { name: 'Synthetic phone', variantId: input.variantId },
    });
    const acceptance = { revisionId: input.revisionId, actorId };
    await expect(store(101).accept(acceptance)).resolves.toEqual({
      revisionId: input.revisionId,
      outcome: 'accepted',
    });
    const accepted = await store(101).read();
    expect(accepted?.actorId).toBe(actorId);
    expect(accepted?.acceptedAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(accepted?.acceptedAt ?? ''))).toBe(true);
    await store(101).accept(acceptance);
    expect(await store(101).read()).toEqual(accepted);
  });
  it.each([
    { merchantId: '10000000-0000-4000-8000-000000000099' },
    { customerId: '20000000-0000-4000-8000-000000000099' },
    { integrationId: '40000000-0000-4000-8000-000000000099' },
    { expectedBusinessId: 'synthetic-wrong-business' },
  ])('rejects foreign database scope without staging or leaking a snapshot', async (overrides) => {
    await expect(store(105, overrides).stage(command(105))).rejects.toThrow(
      /^Goal policy storage unavailable$/
    );
    await expect(store(105, overrides).read()).rejects.toThrow(
      /^Goal policy storage unavailable$/
    );
    await expect(store(105).read()).resolves.toBeNull();
  });
  it('rejects missing registered terms in SQL without persisting the command', async () => {
    await expect(
      store(102).stage({
        ...command(102),
        termsVersion: 'synthetic-missing-terms',
      })
    ).rejects.toThrow(/^Goal policy storage unavailable$/);
    await expect(store(102).read()).resolves.toBeNull();
  });
  it('rejects an unlinked actor without inserting a receipt', async () => {
    const input = command(103);
    await store(103).stage(input);
    await expect(
      store(103).accept({
        revisionId: input.revisionId,
        actorId: '90000000-0000-4000-8000-000000000099',
      })
    ).rejects.toThrow(/^Goal policy storage unavailable$/);
    expect(await store(103).read()).toMatchObject({
      actorId: null,
      acceptedAt: null,
    });
  });
  it('rejects a deferred COMMIT failure and observes rollback on a new connection', async () => {
    await expect(store(104).stage(command(104))).rejects.toThrow(
      /^Goal policy storage unavailable$/
    );
    await expect(store(104).read()).resolves.toBeNull();
  });
  it('refuses arbitrary SQL, ledger calls and a foreign executor role', async () => {
    const execute = createPiggyvestPostgresExecutor(connection());
    await expect(execute('SELECT 1', [])).rejects.toThrow(
      /^PiggyVest database unavailable$/
    );
    await expect(
      execute(PIGGYVEST_POSTGRES_STATEMENTS.readSavingsLedger.text, [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        '30000000-0000-4000-8000-000000000101',
      ])
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
    await expect(
      createPiggyvestPostgresExecutor(connection('piggyvest_staging_intake'))(
        GOAL_POLICY_STATEMENTS.readGoalPolicy.text,
        [
          scope.integrationId,
          scope.merchantId,
          scope.customerId,
          '30000000-0000-4000-8000-000000000101',
          scope.expectedBusinessId,
        ]
      )
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
  });
});
