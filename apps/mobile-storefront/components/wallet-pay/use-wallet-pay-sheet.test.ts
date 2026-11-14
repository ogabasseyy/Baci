import { act, renderHook } from '@testing-library/react-native';
import {
  useWalletPaySheet,
  WALLET_PAY_AUTO_RECHECKS,
  WALLET_PAY_RECHECK_MS,
} from './use-wallet-pay-sheet';
import type { WalletPayAdapter } from './wallet-pay.types';

const OP = '22222222-2222-4222-8222-222222222222';
const PROOF = 'a'.repeat(64);

function makeAdapter(overrides: Partial<WalletPayAdapter<string>> = {}): {
  [K in keyof WalletPayAdapter<string>]: jest.Mock;
} {
  return {
    start: jest.fn(async () => ({
      kind: 'pin',
      operationId: OP,
      amountKobo: 250_000,
    })),
    verifyPin: jest.fn(async () => ({ kind: 'proof', proof: PROOF })),
    pay: jest.fn(async () => ({ kind: 'delivered', result: 'clean' })),
    ...overrides,
  } as never;
}

function setup() {
  const onDelivered = jest.fn();
  const hook = renderHook(() => useWalletPaySheet<string>({ onDelivered }));
  return { hook, onDelivered };
}

async function openAndType(
  hook: ReturnType<typeof setup>['hook'],
  adapter: WalletPayAdapter<string>,
  pin = '1234'
) {
  await act(async () => {
    await hook.result.current.open(adapter);
  });
  act(() => hook.result.current.setPin(pin));
}

afterEach(() => jest.useRealTimers());

describe('useWalletPaySheet', () => {
  it('moves money once: one PIN check, one pay with the proof, then the result', async () => {
    const { hook, onDelivered } = setup();
    const adapter = makeAdapter();
    await openAndType(hook, adapter);
    expect(hook.result.current.step).toBe('enter');
    expect(hook.result.current.amountKobo).toBe(250_000);

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(adapter.verifyPin).toHaveBeenCalledWith(OP, '1234');
    expect(adapter.pay).toHaveBeenCalledTimes(1);
    expect(adapter.pay).toHaveBeenCalledWith(OP, PROOF);
    expect(onDelivered).toHaveBeenCalledWith('clean');
    expect(hook.result.current.step).toBe('closed');
  });

  it('moves nothing on a wrong PIN and keeps the PIN step', async () => {
    const { hook } = setup();
    const adapter = makeAdapter({
      verifyPin: jest.fn(async () => ({
        kind: 'retry' as const,
        message: 'That PIN is not right.',
      })),
    });
    await openAndType(hook, adapter, '0000');
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(adapter.pay).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe('enter');
    expect(hook.result.current.error).toBe('That PIN is not right.');
    expect(hook.result.current.pin).toBe('');
  });

  it('moves nothing when the PIN is missing or too short', async () => {
    const { hook } = setup();
    const adapter = makeAdapter();
    await openAndType(hook, adapter, '12');
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(adapter.verifyPin).not.toHaveBeenCalled();
    expect(adapter.pay).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('Enter 4 to 6 digits.');
  });

  it('shows a refunded outcome when fulfilment fails', async () => {
    const { hook, onDelivered } = setup();
    const adapter = makeAdapter({
      pay: jest.fn(async () => ({
        kind: 'outcome' as const,
        outcome: { kind: 'refunded' as const },
      })),
    });
    await openAndType(hook, adapter);
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(onDelivered).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe('outcome');
    expect(hook.result.current.outcome).toEqual({ kind: 'refunded' });
  });

  it('treats a lost pay answer as still confirming and re-checks with an empty proof', async () => {
    jest.useFakeTimers();
    const { hook } = setup();
    const pay = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ kind: 'delivered', result: 'clean' });
    const adapter = makeAdapter({ pay });
    await openAndType(hook, adapter);
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.outcome).toEqual({ kind: 'pending' });

    await act(async () => {
      jest.advanceTimersByTime(WALLET_PAY_RECHECK_MS);
    });

    expect(pay).toHaveBeenNthCalledWith(1, OP, PROOF);
    expect(pay).toHaveBeenNthCalledWith(2, OP, '');
    expect(hook.result.current.step).toBe('closed');
  });

  it('stops checking by itself after a few tries', async () => {
    jest.useFakeTimers();
    const { hook } = setup();
    const pending = {
      kind: 'outcome' as const,
      outcome: { kind: 'pending' as const },
    };
    const adapter = makeAdapter({ pay: jest.fn(async () => pending) });
    await openAndType(hook, adapter);
    await act(async () => {
      await hook.result.current.submit();
    });
    for (let i = 0; i < WALLET_PAY_AUTO_RECHECKS + 2; i += 1)
      await act(async () => {
        jest.advanceTimersByTime(WALLET_PAY_RECHECK_MS);
      });
    expect(adapter.pay).toHaveBeenCalledTimes(1 + WALLET_PAY_AUTO_RECHECKS);
  });

  it('re-checks a payment already sent without asking for a PIN', async () => {
    const { hook } = setup();
    const adapter = makeAdapter({
      start: jest.fn(async () => ({
        kind: 'recheck' as const,
        operationId: OP,
        amountKobo: 250_000,
      })),
    });
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    expect(adapter.verifyPin).not.toHaveBeenCalled();
    expect(adapter.pay).toHaveBeenCalledWith(OP, '');
  });

  it('drops an answer that arrives after the sheet was closed', async () => {
    const { hook, onDelivered } = setup();
    let release: (value: unknown) => void = () => undefined;
    const adapter = makeAdapter({
      verifyPin: jest.fn(
        () => new Promise((resolve) => (release = resolve))
      ) as never,
    });
    await openAndType(hook, adapter);
    let submitted: Promise<void> = Promise.resolve();
    act(() => {
      submitted = hook.result.current.submit();
    });
    act(() => hook.result.current.close());
    await act(async () => {
      release({ kind: 'proof', proof: PROOF });
      await submitted;
    });
    expect(adapter.pay).not.toHaveBeenCalled();
    expect(onDelivered).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe('closed');
  });
});
