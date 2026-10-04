import { beforeEach, expect, it, vi } from 'vitest';
import { recordPiggyvestGoalLifecycleTerms } from './goal-lifecycle-terms';
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
  command: { action: 'prepare', revisionId: uuid, durationMonths: 1 },
};
const execute = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPiggyvestPostgresExecutor).mockReturnValue(execute);
  execute.mockResolvedValue({
    rows: [
      { result: { revisionId: uuid, durationMonths: 1, outcome: 'prepared' } },
    ],
  });
});
it('prepares the explicitly selected shorter duration without defaulting', async () => {
  await expect(recordPiggyvestGoalLifecycleTerms(input)).resolves.toMatchObject(
    { durationMonths: 1, outcome: 'prepared' }
  );
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('prepare_lifecycle_terms'),
    [uuid, uuid, uuid, uuid, 'synthetic-business', uuid, 1]
  );
});
it('uses injected execution while preserving exact duration and no second connection', async () => {
  const injected = vi.fn().mockResolvedValue({
    rows: [
      {
        result: { revisionId: uuid, durationMonths: 1, outcome: 'prepared' },
      },
    ],
  });
  const { database: _database, ...bound } = input;
  await expect(
    recordPiggyvestGoalLifecycleTerms(
      { ...bound, transport: 'local_test' },
      injected
    )
  ).resolves.toMatchObject({ durationMonths: 1 });
  expect(injected).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('prepare_lifecycle_terms'),
    [uuid, uuid, uuid, uuid, 'synthetic-business', uuid, 1]
  );
  expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
});
it('rejects disabled injected lifecycle terms before execution', async () => {
  const injected = vi.fn();
  const { database: _database, ...bound } = input;
  await expect(
    recordPiggyvestGoalLifecycleTerms(
      { ...bound, enabled: false, transport: 'local_test' },
      injected
    )
  ).rejects.toThrow();
  expect(injected).not.toHaveBeenCalled();
});
it('accepts exact prepared duration with explicit consent and derived actor', async () => {
  execute.mockResolvedValue({
    rows: [
      { result: { revisionId: uuid, durationMonths: 1, outcome: 'accepted' } },
    ],
  });
  await expect(
    recordPiggyvestGoalLifecycleTerms({
      ...input,
      command: {
        ...input.command,
        action: 'accept',
        actorId: uuid,
        accepted: true,
      },
    })
  ).resolves.toMatchObject({ outcome: 'accepted' });
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('accept_lifecycle_terms'),
    [uuid, uuid, uuid, uuid, 'synthetic-business', uuid, uuid, 1]
  );
});
it.each([
  undefined,
  null,
  0,
  1.5,
  7,
])('rejects absent or unsupported duration %s before connection', async (durationMonths) => {
  await expect(
    recordPiggyvestGoalLifecycleTerms({
      ...input,
      command: { ...input.command, durationMonths },
    })
  ).rejects.toThrow('Goal lifecycle terms unavailable');
  expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
});
it('rejects missing affirmative duration consent', async () => {
  await expect(
    recordPiggyvestGoalLifecycleTerms({
      ...input,
      command: { ...input.command, action: 'accept', actorId: uuid },
    })
  ).rejects.toThrow();
  expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
});
it('rejects a changed duration acknowledgement', async () => {
  execute.mockResolvedValue({
    rows: [
      { result: { revisionId: uuid, durationMonths: 6, outcome: 'prepared' } },
    ],
  });
  await expect(recordPiggyvestGoalLifecycleTerms(input)).rejects.toThrow(
    'Goal lifecycle terms unavailable'
  );
  expect(execute).toHaveBeenCalledOnce();
});
