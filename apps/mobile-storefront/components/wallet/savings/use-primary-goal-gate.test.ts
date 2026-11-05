import { act, renderHook, waitFor } from '@testing-library/react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/is-piggyvest-primary-merchant');

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const account = { account_number: '1' } as never;
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

function signIn(id: string | null, merchantId: string | null = MERCHANT) {
  act(() => {
    useAuthStore.setState({
      user: id ? ({ id } as never) : null,
      merchantId,
    });
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
  signIn('user-a');
});

describe('usePrimaryGoalGate', () => {
  it('is checking, then ready only for a ready snapshot with an account', async () => {
    read.mockResolvedValue({
      account,
      requiresConsent: false,
      provisioningStatus: 'ready',
    });
    const { result } = renderHook(() => usePrimaryGoalGate());
    expect(result.current).toBe('checking');
    await waitFor(() => expect(result.current).toBe('ready'));
    expect(read).toHaveBeenCalledWith(MERCHANT, 'user-a');
  });

  it.each([
    [
      'a pending snapshot',
      { account: null, requiresConsent: true, provisioningStatus: 'pending' },
    ],
    [
      'a ready status with no account',
      { account: null, requiresConsent: false, provisioningStatus: 'ready' },
    ],
  ])('is off for %s', async (_name, snapshot) => {
    read.mockResolvedValue(snapshot as never);
    const { result } = renderHook(() => usePrimaryGoalGate());
    await waitFor(() => expect(result.current).toBe('off'));
  });

  it.each([
    'PIGGYVEST_NOT_READY',
    undefined,
  ])('is off when the read rejects (%s)', async (code) => {
    read.mockRejectedValue(Object.assign(new Error('nope'), { code }));
    const { result } = renderHook(() => usePrimaryGoalGate());
    await waitFor(() => expect(result.current).toBe('off'));
  });

  it('is off without reading for a non-primary merchant or a signed-out customer', () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(false);
    const { result, rerender } = renderHook(() => usePrimaryGoalGate());
    expect(result.current).toBe('off');
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    signIn(null);
    rerender({});
    expect(result.current).toBe('off');
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores a late answer after an account switch', async () => {
    let answerA: (value: never) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerA = resolve as never;
        })
    );
    read.mockResolvedValueOnce({
      account: null,
      requiresConsent: true,
      provisioningStatus: 'pending',
    });
    const { result } = renderHook(() => usePrimaryGoalGate());
    expect(result.current).toBe('checking');
    signIn('user-b');
    await waitFor(() => expect(result.current).toBe('off'));
    await act(async () => {
      answerA({
        account,
        requiresConsent: false,
        provisioningStatus: 'ready',
      } as never);
    });
    expect(result.current).toBe('off');
    expect(read).toHaveBeenLastCalledWith(MERCHANT, 'user-b');
  });
});
