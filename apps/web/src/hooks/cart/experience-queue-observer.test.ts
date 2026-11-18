import { expect, it, vi } from 'vitest';
import { createExperienceQueueObserver } from './experience-queue-observer';

const make = () => {
  const entry = {
    generation: 1,
    prepare: vi.fn(async () => true),
    policy: { beforeAttempt: () => ({ allowed: true }) },
    deny: vi.fn(),
    finish: vi.fn(),
    canProject: () => true,
  };
  const dispatch = vi.fn();
  return { entry, dispatch };
};
it('adopts a failed command snapshot then cancels without native retry/rebase', () => {
  const { entry, dispatch } = make();
  const observer = createExperienceQueueObserver(entry as never, {
    generation: 1,
    operationId: 'original',
    isCurrent: () => true,
    dispatch,
  });
  const snapshot = { version: 2 };
  expect(
    observer.finish({
      ok: false,
      code: 'version_conflict',
      snapshot,
      retryable: true,
    } as never)
  ).toBe(false);
  expect(dispatch.mock.calls.map(([a]) => a.type)).toEqual([
    'snapshot/polled',
    'command/cancel',
  ]);
});
it('records an accepted old-generation response without exposing or adopting its snapshot', () => {
  const { entry, dispatch } = make();
  const result = { ok: true, snapshot: { version: 2 } };
  const observer = createExperienceQueueObserver(entry as never, {
    generation: 1,
    operationId: 'original',
    isCurrent: () => false,
    dispatch,
  });
  expect(observer.finish(result as never)).toBe(false);
  expect(entry.finish).toHaveBeenCalledWith(result, false);
  expect(dispatch).not.toHaveBeenCalled();
});
it('cancels a failed preparation without beginning an engine request', async () => {
  const { entry, dispatch } = make();
  entry.prepare.mockRejectedValueOnce(Error('continuity lost'));
  const observer = createExperienceQueueObserver(entry as never, {
    generation: 1,
    operationId: 'original',
    isCurrent: () => true,
    dispatch,
  });
  expect(await observer.prepare({} as never)).toBe(false);
  expect(entry.deny).toHaveBeenCalledOnce();
  expect(dispatch).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'command/cancel' })
  );
});
