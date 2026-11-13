import { act, renderHook } from '@testing-library/react-native';
import { useWalletPaySheet } from './use-wallet-pay-sheet';
import type { WalletPayAdapter } from './wallet-pay.types';

const OP = '22222222-2222-4222-8222-222222222222';
const PROOF = 'a'.repeat(64);

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeAdapter(overrides: Partial<WalletPayAdapter<string>> = {}): {
  [K in keyof WalletPayAdapter<string>]: jest.Mock;
} {
  return {
    start: jest.fn(async () => ({
      kind: 'pin',
      operationId: OP,
      amountKobo: 30_000,
    })),
    verifyPin: jest.fn(async () => ({ kind: 'proof', proof: PROOF })),
    pay: jest.fn(async () => ({ kind: 'delivered', result: 'clean' })),
    ...overrides,
  } as never;
}

const setup = () =>
  renderHook(() => useWalletPaySheet<string>({ onDelivered: jest.fn() }));

describe('bugfix: overlapping wallet pay calls (Muse review)', () => {
  it('ignores a second open (double tap) while the first is starting', async () => {
    const hook = setup();
    const gate = deferred<{
      kind: 'pin';
      operationId: string;
      amountKobo: number;
    }>();
    const first = makeAdapter({ start: jest.fn(() => gate.promise) as never });
    const second = makeAdapter();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = hook.result.current.open(first);
    });
    await act(async () => {
      await hook.result.current.open(second);
    });
    expect(second.start).not.toHaveBeenCalled();
    await act(async () => {
      gate.resolve({ kind: 'pin', operationId: OP, amountKobo: 30_000 });
      await opening;
    });
    expect(hook.result.current.step).toBe('enter');
  });

  it('lets the PIN be submitted after reopening over a PIN check that never answered', async () => {
    const hook = setup();
    const stuck = makeAdapter({
      verifyPin: jest.fn(() => new Promise(() => undefined)) as never,
    });
    await act(async () => {
      await hook.result.current.open(stuck);
    });
    act(() => hook.result.current.setPin('1234'));
    act(() => {
      void hook.result.current.submit();
    });
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.close());

    const fresh = makeAdapter();
    await act(async () => {
      await hook.result.current.open(fresh);
    });
    expect(hook.result.current.busy).toBe(false);
    act(() => hook.result.current.setPin('1234'));
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(fresh.verifyPin).toHaveBeenCalledWith(OP, '1234');
    expect(fresh.pay).toHaveBeenCalledTimes(1);
  });

  it('does not send a second re-check while one is out', async () => {
    const hook = setup();
    const gate = deferred<unknown>();
    const pay = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'outcome', outcome: { kind: 'pending' } })
      .mockImplementation(() => gate.promise);
    const adapter = makeAdapter({ pay });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    act(() => hook.result.current.setPin('1234'));
    await act(async () => {
      await hook.result.current.submit();
    });
    act(() => {
      void hook.result.current.recheck();
    });
    await act(async () => {
      await hook.result.current.recheck();
    });
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it('stays open on back while money is moving, and closes otherwise', async () => {
    const hook = setup();
    const gate = deferred<unknown>();
    const adapter = makeAdapter({ pay: jest.fn(() => gate.promise) as never });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    act(() => hook.result.current.setPin('1234'));
    act(() => {
      void hook.result.current.submit();
    });
    await act(async () => undefined);
    expect(hook.result.current.step).toBe('paying');
    act(() => hook.result.current.back());
    expect(hook.result.current.step).toBe('paying');
    await act(async () => {
      gate.resolve({ kind: 'outcome', outcome: { kind: 'review' } });
    });
    act(() => hook.result.current.back());
    expect(hook.result.current.step).toBe('closed');
  });

  it('closes on back while the payment is still being set up', async () => {
    const hook = setup();
    const gate = deferred<{
      kind: 'pin';
      operationId: string;
      amountKobo: number;
    }>();
    const adapter = makeAdapter({
      start: jest.fn(() => gate.promise) as never,
    });
    act(() => {
      void hook.result.current.open(adapter);
    });
    expect(hook.result.current.step).toBe('starting');
    act(() => hook.result.current.back());
    expect(hook.result.current.step).toBe('closed');
    await act(async () => {
      gate.resolve({ kind: 'pin', operationId: OP, amountKobo: 30_000 });
    });
    expect(hook.result.current.step).toBe('closed');
  });

  it('retries a start that never answered, without calling it failed', async () => {
    const hook = setup();
    const start = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        kind: 'pin',
        operationId: OP,
        amountKobo: 30_000,
      });
    const adapter = makeAdapter({ start });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    expect(hook.result.current.outcome).toEqual({ kind: 'not_started' });
    await act(async () => {
      await hook.result.current.retryStart();
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(hook.result.current.step).toBe('enter');
  });

  it('shows a replayed result straight away', async () => {
    const onDelivered = jest.fn();
    const hook = renderHook(() => useWalletPaySheet<string>({ onDelivered }));
    const adapter = makeAdapter({
      start: jest.fn(async () => ({
        kind: 'delivered' as const,
        result: 'clean',
      })),
    });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    expect(onDelivered).toHaveBeenCalledWith('clean');
    expect(adapter.pay).not.toHaveBeenCalled();
  });

  it('asks the start again when it was still settling, without a PIN', async () => {
    const hook = setup();
    const start = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'outcome', outcome: { kind: 'pending' } })
      .mockResolvedValueOnce({ kind: 'delivered', result: 'clean' });
    const adapter = makeAdapter({ start });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    await act(async () => {
      await hook.result.current.recheck();
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(adapter.pay).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe('closed');
  });

  it('bugfix: back did not wait for a PIN check like the close button (Muse)', async () => {
    const hook = setup();
    const gate = deferred<unknown>();
    const adapter = makeAdapter({
      verifyPin: jest.fn(() => gate.promise) as never,
    });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    act(() => hook.result.current.setPin('1234'));
    act(() => {
      void hook.result.current.submit();
    });
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.back());
    expect(hook.result.current.step).toBe('enter');
    await act(async () => {
      gate.resolve({ kind: 'proof', proof: PROOF });
    });
    expect(adapter.pay).toHaveBeenCalledWith(OP, PROOF);
  });
});
