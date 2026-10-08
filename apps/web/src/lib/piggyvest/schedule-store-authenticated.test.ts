import { expect, it, vi } from 'vitest';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));

it('authenticates before malformed input and performs no SQL when signed out', async () => {
  const execute = vi.fn();
  const test = scheduleStoreRuntimeFixture(101, execute);
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect(await test.store.submit(null)).toMatchObject({
    status: 'unconfirmed',
    debitPermission: false,
  });
  expect(test.getUser).toHaveBeenCalledOnce();
  expect(test.from).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it('revalidates current actor immediately before each database access', async () => {
  const execute = vi.fn();
  const test = scheduleStoreRuntimeFixture(101, execute);
  test.getUser.mockResolvedValueOnce({
    data: { user: { id: test.actorId } },
    error: null,
  });
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(test.store.read()).rejects.toThrow('Schedule unavailable');
  expect(execute).not.toHaveBeenCalled();
});

it('does not send caller-selected scope or actor into SQL', async () => {
  const execute = vi.fn();
  const test = scheduleStoreRuntimeFixture(101, execute);
  expect(
    await test.store.submit({
      operationId: test.actorId,
      actorId: test.actorId,
      command: { action: 'pause', expectedVersion: 0, goalId: test.goalId },
    })
  ).toMatchObject({ status: 'unconfirmed' });
  expect(execute).not.toHaveBeenCalled();
});
