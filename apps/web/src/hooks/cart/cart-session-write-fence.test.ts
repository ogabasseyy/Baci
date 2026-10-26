import { expect, it, vi } from 'vitest';
import {
  beginCartSessionRetirement,
  runCartSessionWrite,
} from './cart-session-write-fence';

it('drains existing writes and blocks replacement authority until retirement finishes', async () => {
  let finish!: () => void;
  const pending = runCartSessionWrite(
    'shop',
    false,
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  await Promise.resolve();
  const retirement = beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  const replacement = vi.fn().mockResolvedValue(true);
  await expect(runCartSessionWrite('shop', false, replacement)).resolves.toBe(
    false
  );
  expect(replacement).not.toHaveBeenCalled();
  expect(drained).not.toHaveBeenCalled();
  finish();
  await pending;
  await retirement.drained;
  retirement.release();
  await expect(runCartSessionWrite('shop', false, replacement)).resolves.toBe(
    true
  );
});
it('includes host-resolved writes while keeping named merchants isolated', async () => {
  const retirement = beginCartSessionRetirement('shop');
  await expect(
    runCartSessionWrite(undefined, false, async () => true)
  ).resolves.toBe(false);
  await expect(
    runCartSessionWrite('other', false, async () => true)
  ).resolves.toBe(true);
  retirement.release();
});
it('holds the retirement fence until aborted transition work actually settles', async () => {
  const { isCartSessionRetiring, runCartSessionTransition } = await import(
    './cart-session-write-fence'
  );
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const operation = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const pending = runCartSessionTransition('shop-fence', 'blocked', operation, {
    isSuccessful: () => true,
    signal: controller.signal,
  });
  // Let the transition acquire its retirement and start the operation.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(operation).toHaveBeenCalledOnce();
  controller.abort();
  await expect(pending).resolves.toBe('blocked');
  // The caller-visible result settled, but the fence must remain held
  // while the signal-ignoring operation is still running.
  expect(isCartSessionRetiring('shop-fence')).toBe(true);
  // A new retirement must not drain until the work settles either.
  const { beginCartSessionRetirement } = await import(
    './cart-session-write-fence'
  );
  const retirement = beginCartSessionRetirement('shop-fence');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(drained).not.toHaveBeenCalled();
  finish('done');
  await retirement.drained;
  retirement.release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(isCartSessionRetiring('shop-fence')).toBe(false);
});
