// Automatic account-number checks, split from PiggyvestWalletSetupPanel.test.tsx.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { create: jest.fn(), read: jest.fn() },
}));

const mockAuthUserId: string | null = 'user-a-id';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) =>
    selector({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
}));

it('checks for the account number by itself and finishes when it is ready', async () => {
  jest.useFakeTimers();
  try {
    const onRefresh = jest.fn();
    jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
      provisioningStatus: 'pending',
      requiresConsent: false,
      account: null,
    });
    jest
      .mocked(piggyvestPrimaryWalletApi.read)
      .mockResolvedValueOnce({
        provisioningStatus: 'pending',
        requiresConsent: false,
        account: null,
      })
      .mockResolvedValue({
        provisioningStatus: 'ready',
        requiresConsent: false,
        account: {
          accountNumber: '0123456789',
          bankName: 'Test Bank',
          accountName: 'Test User',
        },
      } as never);
    render(
      <PiggyvestWalletSetupPanel
        colors={Colors.light}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        needsPhone={false}
        onSubmitPhone={async () => ({ success: true })}
        onRefresh={onRefresh}
        onClose={jest.fn()}
      />
    );
    fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(
      screen.getByRole('button', { name: 'Create account number' })
    );
    await screen.findByText('Setting up your account number');

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  } finally {
    jest.useRealTimers();
  }
});

it('never overlaps automatic checks while one is still in flight', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
      provisioningStatus: 'pending',
      requiresConsent: false,
      account: null,
    });
    // A slow read that never settles during the test.
    const read = jest
      .mocked(piggyvestPrimaryWalletApi.read)
      .mockReturnValue(new Promise(() => undefined));
    render(
      <PiggyvestWalletSetupPanel
        colors={Colors.light}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        needsPhone={false}
        onSubmitPhone={async () => ({ success: true })}
        onRefresh={jest.fn()}
        onClose={jest.fn()}
      />
    );
    fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(
      screen.getByRole('button', { name: 'Create account number' })
    );
    await screen.findByText('Setting up your account number');
    const readsBefore = read.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });

    expect(read.mock.calls.length - readsBefore).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});
