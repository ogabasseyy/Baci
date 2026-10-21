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
