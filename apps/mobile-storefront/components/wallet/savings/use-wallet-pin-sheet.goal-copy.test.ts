import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyGoalActionPin,
} from '@/lib/wallet-pin-api';
import { useWalletPinSheet } from './use-wallet-pin-sheet';

jest.mock('@/lib/wallet-pin-api');

const request = {
  action: 'cancel',
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
} as const;
const fail = (code: string | undefined, message: string) =>
  Object.assign(new Error(message), code ? { code } : {});
const status = (over: Record<string, boolean>) =>
  jest.mocked(fetchWalletPinStatus).mockResolvedValue({
    primary: true,
    hasPin: true,
    resetRequired: false,
    available: true,
    ...over,
  });

beforeEach(() => {
  jest.resetAllMocks();
  status({});
});

async function open() {
  const hook = renderHook(() =>
    useWalletPinSheet({ request, onProof: jest.fn() })
  );
  await waitFor(() => expect(hook.result.current.step).not.toBe('loading'));
  return hook;
}

describe('goal-action PIN errors', () => {
  it.each([
    [
      'a network failure',
      fail(undefined, 'TypeError: fetch failed at 10.0.0.4'),
    ],
    ['an unknown server code', fail('DB_EXPLODED', 'relation "x" missing')],
  ])('hide the raw text of %s', async (_name, failure) => {
    jest.mocked(verifyGoalActionPin).mockRejectedValue(failure);
    const { result } = await open();
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('still shows the PIN service copy for a wrong PIN', async () => {
    jest
      .mocked(verifyGoalActionPin)
      .mockRejectedValue(fail('PIN_INCORRECT', 'That PIN is not right.'));
    const { result } = await open();
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe('That PIN is not right.');
  });
});

describe('the notice after saving a PIN for a goal action', () => {
  it('is short, so the confirmation can still name the action', async () => {
    status({ hasPin: false });
    jest.mocked(submitWalletPin).mockResolvedValue(undefined as never);
    // The straight-away approval fails, so the customer is asked once more.
    jest
      .mocked(verifyGoalActionPin)
      .mockRejectedValue(fail('PIN_BUSY', 'Please try again.'));
    const { result } = await open();
    expect(result.current.step).toBe('set');
    act(() => {
      result.current.setPin('4821');
      result.current.setConfirmPin('4821');
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.step).toBe('enter');
    expect(result.current.notice).toBe('PIN saved.');
    expect(result.current.notice).not.toMatch(/contribution/);
  });
});
