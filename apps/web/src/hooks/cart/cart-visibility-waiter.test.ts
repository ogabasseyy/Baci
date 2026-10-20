import { afterEach, expect, it, vi } from 'vitest';
import { createCartVisibilityWaiter } from './cart-visibility-waiter';

afterEach(() => vi.restoreAllMocks());
it('runs only the latest waiter once the document is visible', () => {
  let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const waiter = createCartVisibilityWaiter();
  const first = vi.fn();
  const second = vi.fn();
  waiter.wait(first);
  waiter.wait(second);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(second).not.toHaveBeenCalled();
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});
it('cancels an outstanding waiter', () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const waiter = createCartVisibilityWaiter();
  const callback = vi.fn();
  waiter.wait(callback);
  waiter.cancel();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(callback).not.toHaveBeenCalled();
});
