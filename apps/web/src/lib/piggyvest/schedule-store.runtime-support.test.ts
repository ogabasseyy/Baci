import { expect, it, vi } from 'vitest';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
it('pins synthetic goal and owner identity while routing only through the injected executor', async () => {
  const execute = vi.fn(async () => ({ rows: [] }));
  const fixture = scheduleStoreRuntimeFixture(403, execute);
  expect(fixture.goalId).toBe('30000000-0000-4000-8000-000000000403');
  expect(await fixture.options.supabase.auth.getUser()).toMatchObject({
    data: { user: { id: fixture.actorId } },
  });
  expect(
    await fixture.options.supabase
      .from('customer_savings_goals')
      .select('id')
      .eq('id', fixture.goalId)
      .maybeSingle()
  ).toMatchObject({ data: { id: fixture.goalId } });
  await expect(fixture.store.read()).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]).toMatchObject([
    expect.any(String),
    expect.arrayContaining([fixture.goalId, fixture.actorId]),
  ]);
});
