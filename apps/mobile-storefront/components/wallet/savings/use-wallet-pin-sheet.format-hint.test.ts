import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import { useWalletPinSheet } from './use-wallet-pin-sheet';

jest.mock('@/lib/wallet-pin-api');

const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 100000,
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchWalletPinStatus).mockResolvedValue({
    primary: true,
    hasPin: true,
    resetRequired: false,
    available: true,
  });
});

// Walk 14: "Enter 4 to 6 digits." stayed under four filled PIN boxes.
describe('bugfix: the PIN format hint outlived the digits that fixed it', () => {
  it('clears the format hint as soon as the customer types again', async () => {
    const { result } = renderHook(() =>
      useWalletPinSheet({ request, onProof: jest.fn() })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('12'));
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe('Enter 4 to 6 digits.');
    act(() => result.current.setPin('1234'));
    expect(result.current.error).toBeNull();
  });
});
