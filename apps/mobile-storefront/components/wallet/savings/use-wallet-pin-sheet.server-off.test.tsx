import { renderHook, waitFor } from '@testing-library/react-native';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { useWalletPinSheet } from './use-wallet-pin-sheet';

jest.mock('@/lib/wallet-pin-api');

const request = {
  merchantId: 'm',
  goalId: 'g',
  operationId: 'o',
  amountKobo: 1,
};

describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.resetAllMocks());

  it('makes no network call while no PIN is requested', () => {
    renderHook(() => useWalletPinSheet({ request: null, onProof: jest.fn() }));
    expect(fetchWalletPinStatus).not.toHaveBeenCalled();
  });

  it('never offers set-a-PIN when the server reports not primary', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue({
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    });
    const { result } = renderHook(() =>
      useWalletPinSheet({ request, onProof: jest.fn() })
    );
    await waitFor(() => expect(result.current.step).toBe('unavailable'));
  });

  it('treats a missing answer as unavailable, not as set-a-PIN', async () => {
    jest.mocked(fetchWalletPinStatus).mockRejectedValue(new Error('x'));
    const { result } = renderHook(() =>
      useWalletPinSheet({ request, onProof: jest.fn() })
    );
    await waitFor(() => expect(result.current.step).toBe('unavailable'));
  });

  it('reports a goal-action request unavailable when the server says not primary', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue({
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    });
    const { result } = renderHook(() =>
      useWalletPinSheet({
        request: {
          action: 'cancel',
          merchantId: 'm',
          goalId: 'g',
          operationId: 'o',
        },
        onProof: jest.fn(),
      })
    );
    await waitFor(() => expect(result.current.step).toBe('unavailable'));
  });
});
