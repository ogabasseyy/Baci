import { afterEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from '@/hooks/cart/cart-cross-tab-lock.test-support';
import {
  isCartSessionRetiring,
  runBoundedCartSessionWrite,
} from '@/hooks/cart/cart-session-write-fence';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type HandoffRedeemDeps,
  postHandoffRedeem,
} from './cart-handoff-redeem';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
afterEach(() => {
  vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
it('shares a single deadline between retirement drain and handoff network work', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: new CookieLockHarness(),
  });
  let finish!: (value: boolean) => void;
  const writer = runBoundedCartSessionWrite(
    'shop',
    false,
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  await vi.advanceTimersByTimeAsync(0);
  vi.mocked(fetchWithCsrf).mockImplementation(() => new Promise(() => {}));
  const deps: HandoffRedeemDeps = {
    handoffId: 'id',
    merchantSlug: 'shop',
    bootstrapRequired: { current: false },
    setRedeeming: vi.fn(),
    setRedeemError: vi.fn(),
    setConflicts: vi.fn(),
    setResolutions: vi.fn(),
    setLoadError: vi.fn(),
    onAttemptConsumed: vi.fn(),
    onTerminalOutcome: vi.fn(),
    onMergeConflict: vi.fn(),
    refreshPreview: vi.fn(),
  };
  const completed = vi.fn();
  const pending = postHandoffRedeem(deps, {
    choice: 'connect',
    attemptId: 'attempt',
  }).then(completed);
  await vi.advanceTimersByTimeAsync(12_000);
  finish(true);
  await writer;
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchWithCsrf).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(completed).toHaveBeenCalledWith(false);
  await pending;
  expect(isCartSessionRetiring('shop')).toBe(false);
  expect(deps.onAttemptConsumed).not.toHaveBeenCalled();
});
it('cancels queued lock acquisition without sending a late redeem POST', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(fetchWithCsrf).mockReset();
  const locks = new CookieLockHarness();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  let release!: () => void;
  const otherTab = locks.request(
    'baci-cart-cookie-authority',
    { mode: 'exclusive' },
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await vi.advanceTimersByTimeAsync(0);
  const deps: HandoffRedeemDeps = {
    handoffId: 'id',
    merchantSlug: 'shop',
    bootstrapRequired: { current: false },
    setRedeeming: vi.fn(),
    setRedeemError: vi.fn(),
    setConflicts: vi.fn(),
    setResolutions: vi.fn(),
    setLoadError: vi.fn(),
    onAttemptConsumed: vi.fn(),
    onTerminalOutcome: vi.fn(),
    onMergeConflict: vi.fn(),
    refreshPreview: vi.fn(),
  };
  const complete = vi.fn();
  const pending = postHandoffRedeem(deps, {
    choice: 'connect',
    attemptId: 'attempt',
  }).then(complete);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(complete).toHaveBeenCalledWith(false);
  expect(isCartSessionRetiring('shop')).toBe(false);
  release();
  await otherTab;
  await pending;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetchWithCsrf).not.toHaveBeenCalled();
});
