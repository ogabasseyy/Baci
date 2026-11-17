import { act, renderHook } from '@testing-library/react-native';
import { useWalletPaySheet } from './use-wallet-pay-sheet';
import type { WalletPayAdapter } from './wallet-pay.types';

const OP = '22222222-2222-4222-8222-222222222222';

describe('bugfix: a start closed mid-replay forgot its delivered key (Codex P1)', () => {
  it('reports the opened sheet as wanted until it is closed or reopened', async () => {
    const hook = renderHook(() =>
      useWalletPaySheet<string>({ onDelivered: jest.fn() })
    );
    const adapter: WalletPayAdapter<string> = {
      start: jest.fn(async () => ({
        kind: 'pin' as const,
        operationId: OP,
        amountKobo: 100,
      })),
      verifyPin: jest.fn(),
      pay: jest.fn(),
    };
    const wanted = hook.result.current.nextSession();
    await act(async () => {
      await hook.result.current.open(adapter);
    });
    expect(wanted()).toBe(true);
    act(() => hook.result.current.close());
    expect(wanted()).toBe(false);
  });

  it('drops the answer of a start closed while it was out, and says so', async () => {
    const hook = renderHook(() =>
      useWalletPaySheet<string>({ onDelivered: jest.fn() })
    );
    let answer: (value: never) => void = () => undefined;
    const adapter: WalletPayAdapter<string> = {
      start: jest.fn(() => new Promise<never>((resolve) => (answer = resolve))),
      verifyPin: jest.fn(),
      pay: jest.fn(),
    };
    const wanted = hook.result.current.nextSession();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = hook.result.current.open(adapter);
    });
    act(() => hook.result.current.close());
    expect(wanted()).toBe(false);
    await act(async () => {
      answer({ kind: 'delivered', result: 'clean' } as never);
      await opening;
    });
    expect(hook.result.current.step).toBe('closed');
  });
});
