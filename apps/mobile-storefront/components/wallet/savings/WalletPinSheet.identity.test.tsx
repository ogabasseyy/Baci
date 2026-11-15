import { createHash } from 'node:crypto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  confirmIdentityCode,
  sendIdentityCode,
} from '@/lib/wallet-identity-confirm-api';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
} from '@/lib/wallet-pin-api';
import { WalletPinSheet } from './WalletPinSheet';

jest.mock('@/lib/wallet-pin-api');
jest.mock('@/lib/wallet-identity-confirm-api', () => ({
  sendIdentityCode: jest.fn(),
  confirmIdentityCode: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', email: 'bassey@example.com' } }),
}));

type Status = Awaited<ReturnType<typeof fetchWalletPinStatus>>;
const proof = createHash('sha256').update('s5m-identity-proof').digest('hex');
const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 250000,
};
const status = (over: Partial<Status>): Status => ({
  primary: true,
  hasPin: false,
  resetRequired: false,
  available: true,
  ...over,
});
const serverError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });
const press = (name: string) =>
  fireEvent.press(screen.getByRole('button', { name }));
const typeDigits = (digits: string) => {
  for (const digit of digits) press(digit);
};

function renderSheet() {
  const onProof = jest.fn();
  render(
    <WalletPinSheet
      colors={Colors.light}
      request={request}
      expectedUserId="user-1"
      onProof={onProof}
      onCancel={jest.fn()}
    />
  );
  return { onProof };
}

async function confirmWithCode() {
  await act(async () => press('Send code'));
  await screen.findByText(
    'Enter the 6-digit code we sent to ba***@example.com.'
  );
  typeDigits('123456');
  await act(async () => press('Confirm'));
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
  jest.mocked(confirmIdentityCode).mockResolvedValue(undefined);
  jest.mocked(submitWalletPin).mockResolvedValue(undefined);
  jest.mocked(verifyFundPin).mockResolvedValue(proof);
});

describe('bugfix: an old sign-in dead-ended PIN creation on "Please sign in again"', () => {
  it('shows "Confirm it\'s you" before the PIN pad when the sign-in is too old', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ signInConfirmationRequired: true }));
    renderSheet();
    expect(await screen.findByText("Confirm it's you")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "To keep your wallet safe, we'll email a 6-digit code to ba***@example.com."
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('Adding ₦2,500 to savings')).toBeOnTheScreen();
    expect(screen.queryByText('Create your wallet PIN')).toBeNull();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    expect(sendIdentityCode).not.toHaveBeenCalled();
  });

  it('checks the emailed code in place, then continues to "Create your wallet PIN"', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ signInConfirmationRequired: true }));
    renderSheet();
    await screen.findByText("Confirm it's you");
    await confirmWithCode();
    expect(await screen.findByText('Create your wallet PIN')).toBeOnTheScreen();
    expect(sendIdentityCode).toHaveBeenCalledWith('bassey@example.com');
    expect(confirmIdentityCode).toHaveBeenCalledWith({
      email: 'bassey@example.com',
      code: '123456',
      expectedUserId: 'user-1',
    });
    expect(submitWalletPin).not.toHaveBeenCalled();
  });

  it('keeps the customer on the code step with the server copy when the code is wrong', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ signInConfirmationRequired: true }));
    jest
      .mocked(confirmIdentityCode)
      .mockRejectedValue(new Error('Invalid verification code.'));
    renderSheet();
    await screen.findByText("Confirm it's you");
    await confirmWithCode();
    expect(
      await screen.findByText('Invalid verification code.')
    ).toBeOnTheScreen();
    expect(screen.getByText("Confirm it's you")).toBeOnTheScreen();
    expect(screen.queryByText('Create your wallet PIN')).toBeNull();
  });

  it('routes a save-time REAUTHENTICATION_REQUIRED back to the code step, then saves the same PIN', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest
      .mocked(submitWalletPin)
      .mockRejectedValueOnce(
        serverError(
          'Please sign in again to continue.',
          'REAUTHENTICATION_REQUIRED'
        )
      );
    const { onProof } = renderSheet();
    await screen.findByText('Create your wallet PIN');
    typeDigits('4821');
    press('Continue');
    typeDigits('4821');
    await act(async () => press('Save PIN'));
    expect(await screen.findByText("Confirm it's you")).toBeOnTheScreen();
    expect(screen.queryByText('Please sign in again to continue.')).toBeNull();
    await confirmWithCode();
    await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof));
    expect(submitWalletPin).toHaveBeenCalledTimes(2);
    expect(submitWalletPin).toHaveBeenLastCalledWith('set', '4821', 'user-1');
  });

  it('confirms first for a required reset too', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(
      status({
        hasPin: true,
        resetRequired: true,
        signInConfirmationRequired: true,
      })
    );
    renderSheet();
    await screen.findByText("Confirm it's you");
    await confirmWithCode();
    expect(await screen.findByText('Reset your wallet PIN')).toBeOnTheScreen();
  });
});

it('asks for nothing extra after a recent sign-in', async () => {
  jest
    .mocked(fetchWalletPinStatus)
    .mockResolvedValue(status({ signInConfirmationRequired: false }));
  renderSheet();
  expect(await screen.findByText('Create your wallet PIN')).toBeOnTheScreen();
  expect(screen.queryByText("Confirm it's you")).toBeNull();
});

it('never asks to confirm before entering an existing PIN', async () => {
  jest
    .mocked(fetchWalletPinStatus)
    .mockResolvedValue(
      status({ hasPin: true, signInConfirmationRequired: true })
    );
  renderSheet();
  expect(await screen.findByText('Enter your wallet PIN')).toBeOnTheScreen();
  expect(screen.queryByText("Confirm it's you")).toBeNull();
});

it('asks for the new PIN once more only when the straight-away approval fails', async () => {
  jest
    .mocked(fetchWalletPinStatus)
    .mockResolvedValue(status({ hasPin: false }));
  jest.mocked(submitWalletPin).mockResolvedValue(undefined);
  jest
    .mocked(verifyFundPin)
    .mockRejectedValue(serverError('Please try again.', 'PIN_BUSY'));
  renderSheet();
  await screen.findByText('Create your wallet PIN');
  typeDigits('4821');
  press('Continue');
  typeDigits('4821');
  await act(async () => press('Save PIN'));
  await screen.findByText('Enter your wallet PIN');
  expect(
    screen.getByText('PIN saved. Enter it again to confirm this contribution.')
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('PIN, 0 of 6 digits entered')).toBeOnTheScreen();
});
