import { expect, it, vi } from 'vitest';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';
import { createScheduleStore } from './schedule-store';
import { SCHEDULE_STORE_STATEMENTS as statements } from './schedule-store-statements';

vi.mock('server-only', () => ({}));

it('commits the actual planner proposal and never acknowledges a lost write', async () => {
  const input = scheduleLifecycleFixture();
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          result: {
            trusted: input.trusted,
            state: input.state,
            token: 'a'.repeat(32),
            historical: null,
          },
        },
      ],
    })
    .mockRejectedValueOnce(new Error('synthetic response lost'));
  const store = createScheduleStore({
    configuration: {
      environment: 'staging',
      ...input.trusted.scope,
      expectedBusinessId: 'synthetic-business',
      actorId: input.trusted.actorId,
    },
    execute,
  });
  const request = {
    operationId: input.trusted.actorId,
    command: {
      ...input.command,
      action: 'request_resume',
      accepted: true,
      operationId: input.trusted.actorId,
      revisionId: input.trusted.revisionId,
      termsHash: input.trusted.termsHash,
    },
  };
  await expect(store.submit(request)).rejects.toThrow(
    'Schedule storage unavailable'
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1][0]).toBe(statements.writeScheduleProposal.text);
  const payload = JSON.parse(execute.mock.calls[1][1][6]);
  expect(payload).toMatchObject({
    token: 'a'.repeat(32),
    proposal: {
      version: 1,
      status: 'resume_proposed',
      consentProposal: { actorId: input.trusted.actorId },
    },
  });
});

it('rejects a successful-looking receipt for another operation', async () => {
  const input = scheduleLifecycleFixture();
  const execute = vi.fn().mockResolvedValueOnce({
    rows: [
      {
        result: {
          trusted: input.trusted,
          state: input.state,
          token: 'a'.repeat(32),
          historical: null,
        },
      },
    ],
  });
  execute.mockImplementationOnce(
    async (_statement: string, parameters: readonly string[]) => ({
      rows: [
        {
          result: {
            operationId: '80000000-0000-4000-8000-000000000099',
            state: JSON.parse(parameters[6]).proposal,
            persisted: true,
            dispatch: 'disabled',
            debitPermission: false,
          },
        },
      ],
    })
  );
  const store = createScheduleStore({
    configuration: {
      environment: 'staging',
      ...input.trusted.scope,
      expectedBusinessId: 'synthetic-business',
      actorId: input.trusted.actorId,
    },
    execute,
  });
  await expect(
    store.submit({
      operationId: input.trusted.actorId,
      command: { ...input.command, action: 'pause' },
    })
  ).rejects.toThrow('Schedule storage unavailable');
});
