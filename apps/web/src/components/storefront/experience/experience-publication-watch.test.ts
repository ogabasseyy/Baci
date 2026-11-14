import { expect, it, vi } from 'vitest';
import { createPublicationAdmission } from './experience-publication-watch';

const current = {
  active: true,
  policyRevision: 'p',
  catalogRevision: 'c',
};

it('coalesces overlapping checks and re-reads after the shared check settles', async () => {
  let resolveRead: (value: typeof current) => void = () => {};
  let calls = 0;
  const read = vi.fn(() => {
    calls++;
    return calls === 1
      ? new Promise<typeof current>((resolve) => {
          resolveRead = resolve;
        })
      : Promise.resolve(current);
  });
  const withdraw = vi.fn();
  const watch = createPublicationAdmission({
    policyRevision: 'p',
    catalogRevision: 'c',
    read,
    withdraw,
  });

  const first = watch.check();
  const concurrent = watch.check();
  await Promise.resolve();
  expect(read).toHaveBeenCalledOnce();
  resolveRead(current);
  expect(await Promise.all([first, concurrent])).toEqual([true, true]);
  expect(await watch.check()).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  expect(withdraw).not.toHaveBeenCalled();
});

it('withdraws on a later inactive publication and does not re-read after revocation', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ ...current, active: false });
  const withdraw = vi.fn();
  const watch = createPublicationAdmission({
    policyRevision: 'p',
    catalogRevision: 'c',
    read,
    withdraw,
  });

  expect(await watch.check()).toBe(true);
  expect(await watch.check()).toBe(false);
  expect(watch.active()).toBe(false);
  expect(await watch.check()).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
  expect(withdraw).toHaveBeenCalledOnce();
});

it.each([
  { state: { ...current, policyRevision: 'changed' }, revision: 'policy' },
  { state: { ...current, catalogRevision: 'changed' }, revision: 'catalog' },
])('withdraws when the $revision revision changes', async ({ state }) => {
  const withdraw = vi.fn();
  const watch = createPublicationAdmission({
    policyRevision: 'p',
    catalogRevision: 'c',
    read: async () => state,
    withdraw,
  });

  expect(await watch.check()).toBe(false);
  expect(watch.active()).toBe(false);
  expect(withdraw).toHaveBeenCalledOnce();
});

it('withdraws on read failure and keeps the denial sticky', async () => {
  const read = vi.fn().mockRejectedValue(Error('unavailable'));
  const withdraw = vi.fn();
  const watch = createPublicationAdmission({
    policyRevision: 'p',
    catalogRevision: 'c',
    read,
    withdraw,
  });

  expect(await watch.check()).toBe(false);
  expect(await watch.check()).toBe(false);
  expect(read).toHaveBeenCalledOnce();
  expect(withdraw).toHaveBeenCalledOnce();
});
