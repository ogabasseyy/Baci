import { expect, it, vi } from 'vitest';
import { createPendingLedger } from './experience-pending-ledger';

it('settles one request once and cancels remaining correlation on session destruction', async () => {
  vi.useFakeTimers();
  try {
    const ledger = createPendingLedger();
    const first = ledger.wait('a');
    expect(() => ledger.wait('a')).toThrow('INVALID_REQUEST');
    ledger.settle('a', 'ok');
    ledger.settle('a', 'late');
    expect(await first).toBe('ok');
    const second = ledger.wait('b');
    const assertion = expect(second).rejects.toThrow('LAUNCH_EXPIRED');
    ledger.destroy();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
