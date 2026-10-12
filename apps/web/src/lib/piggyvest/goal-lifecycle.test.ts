import { beforeEach, expect, it, vi } from 'vitest';
import { activatePiggyvestGoalLifecycle } from './goal-lifecycle';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('./postgres-executor', () => ({
  createPiggyvestPostgresExecutor: vi.fn(),
}));

const uuid = '10000000-0000-4000-8000-000000000001';
const input = {
  enabled: true,
  scope: {
    environment: 'staging',
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    expectedBusinessId: 'synthetic-business',
  },
  database: {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: '/tmp/baci-piggyvest-runtime.synthetic/socket',
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role: 'piggyvest_staging_policy_writer',
    port: 55443,
  },
  command: { operationId: uuid, revisionId: uuid },
};
const receipt = {
  operationId: uuid,
  revisionId: uuid,
  lifecycle: 'active',
  activatedAt: '2026-09-12T00:00:00+00:00',
  guaranteeKobo: 100001,
  collectionPaused: true,
  collectionConsent: 'not_granted',
  evidence: 'local_synthetic_only',
  durationMonths: 1,
  maturesAt: '2026-10-12T00:00:00Z',
  graceExpiresAt: '2026-11-11T00:00:00Z',
};
const execute = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPiggyvestPostgresExecutor).mockReturnValue(execute);
  execute.mockResolvedValue({ rows: [{ result: receipt }] });
});

it('activates using only scope and operation/revision identifiers', async () => {
  await expect(activatePiggyvestGoalLifecycle(input)).resolves.toEqual(receipt);
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    'SELECT piggyvest_goal_policy.activate_lifecycle($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    [uuid, uuid, uuid, uuid, 'synthetic-business', uuid, uuid]
  );
});

it('uses the supplied bounded executor without constructing another connection', async () => {
  const injected = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const { database: _database, ...bound } = input;
  await expect(
    activatePiggyvestGoalLifecycle(
      { ...bound, transport: 'local_test' },
      injected
    )
  ).resolves.toEqual(receipt);
  expect(injected).toHaveBeenCalledOnce();
  expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
});

it('rejects injected execution without explicit local-only enablement', async () => {
  const injected = vi.fn();
  const { database: _database, ...bound } = input;
  await expect(
    activatePiggyvestGoalLifecycle({ ...bound, transport: 'tls' }, injected)
  ).rejects.toThrow('Goal lifecycle unavailable');
  expect(injected).not.toHaveBeenCalled();
});

it.each([
  { ...input, enabled: false },
  { ...input, enabled: undefined },
  { ...input, database: { ...input.database, transport: 'tls' } },
  {
    ...input,
    database: { ...input.database, role: 'piggyvest_staging_ledger_worker' },
  },
  { ...input, command: { ...input.command, principalKobo: 999999 } },
  { ...input, command: { ...input.command, actorId: uuid } },
])('rejects disabled or caller-authoritative input before constructing executor', async (value) => {
  await expect(activatePiggyvestGoalLifecycle(value)).rejects.toThrow(
    'Goal lifecycle unavailable'
  );
  expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
});

it.each([
  { ...receipt, operationId: '20000000-0000-4000-8000-000000000001' },
  { ...receipt, revisionId: '20000000-0000-4000-8000-000000000001' },
  { ...receipt, collectionPaused: false },
  { ...receipt, guaranteeKobo: 1.5 },
  { ...receipt, privateData: 'do not expose' },
])('rejects mismatched or unsafe acknowledgements without retry', async (result) => {
  execute.mockResolvedValue({ rows: [{ result }] });
  await expect(activatePiggyvestGoalLifecycle(input)).rejects.toThrow(
    'Goal lifecycle unavailable'
  );
  expect(execute).toHaveBeenCalledOnce();
});

it('redacts an uncertain executor failure and never retries', async () => {
  execute.mockRejectedValue(new Error('private database details'));
  await expect(activatePiggyvestGoalLifecycle(input)).rejects.toThrow(
    'Goal lifecycle unavailable'
  );
  expect(execute).toHaveBeenCalledOnce();
});
