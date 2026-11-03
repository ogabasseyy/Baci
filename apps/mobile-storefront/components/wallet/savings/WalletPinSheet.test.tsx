import { createHash } from 'node:crypto';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
} from '@/lib/wallet-pin-api';
import { WalletPinSheet } from './WalletPinSheet';

jest.mock('@/lib/wallet-pin-api');

type Status = Awaited<ReturnType<typeof fetchWalletPinStatus>>;
const proof = createHash('sha256').update('s5m-sheet-proof').digest('hex');
const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 250000,
};
const status = (over: Partial<Status>): Status => ({
  primary: true,
  hasPin: true,
  resetRequired: false,
  available: true,
  ...over,
});
const serverError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

function renderSheet() {
  const onProof = jest.fn();
  const onCancel = jest.fn();
  render(
    <WalletPinSheet
      colors={Colors.light}
      request={request}
      onProof={onProof}
      onCancel={onCancel}
    />
  );
  return { onProof, onCancel };
}

function chooseAndSave(button: string, newPin: string, confirm: string) {
  fireEvent.changeText(screen.getByLabelText('New PIN'), newPin);
  fireEvent.changeText(screen.getByLabelText('Confirm PIN'), confirm);
  fireEvent.press(screen.getByRole('button', { name: button }));
}

beforeEach(() => jest.resetAllMocks());

describe('entering the PIN', () => {
  it('verifies the fund action for this goal, operation and amount and hands back the proof', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest.mocked(verifyFundPin).mockResolvedValue(proof);
    const { onProof } = renderSheet();
    await screen.findByText('Enter your wallet PIN');
    fireEvent.changeText(screen.getByLabelText('PIN'), '4821');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof));
    expect(verifyFundPin).toHaveBeenCalledWith({ ...request, pin: '4821' });
    expect(screen.getByLabelText('PIN').props.value).toBe('');
  });

  it('shows the server copy for a wrong PIN and clears the field', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest
      .mocked(verifyFundPin)
      .mockRejectedValue(
        serverError('That PIN is not right.', 'PIN_INCORRECT')
      );
    const { onProof } = renderSheet();
    await screen.findByText('Enter your wallet PIN');
    fireEvent.changeText(screen.getByLabelText('PIN'), '0000');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('That PIN is not right.')).toBeOnTheScreen();
    expect(screen.getByLabelText('PIN').props.value).toBe('');
    expect(onProof).not.toHaveBeenCalled();
  });

  it('shows the server lockout copy', async () => {
    const locked = 'Too many wrong PINs. Please try again later.';
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest
      .mocked(verifyFundPin)
      .mockRejectedValue(serverError(locked, 'PIN_LOCKED'));
    renderSheet();
    await screen.findByText('Enter your wallet PIN');
    fireEvent.changeText(screen.getByLabelText('PIN'), '1234');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(locked)).toBeOnTheScreen();
  });

  it('does not call the server for a PIN that is not 4 to 6 digits', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    await screen.findByText('Enter your wallet PIN');
    fireEvent.changeText(screen.getByLabelText('PIN'), '12a');
    expect(screen.getByLabelText('PIN').props.value).toBe('12');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter 4 to 6 digits.')).toBeOnTheScreen();
    expect(verifyFundPin).not.toHaveBeenCalled();
  });

  it('cancels without a proof', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    const { onCancel, onProof } = renderSheet();
    await screen.findByText('Enter your wallet PIN');
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onProof).not.toHaveBeenCalled();
  });
});

describe('setting a PIN', () => {
  it('asks for a matching confirmation, saves, then asks to enter it', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    jest.mocked(submitWalletPin).mockResolvedValue(undefined);
    renderSheet();
    await screen.findByText('Set a wallet PIN');
    chooseAndSave('Save PIN', '4821', '4822');
    expect(
      await screen.findByText('The two PINs do not match.')
    ).toBeOnTheScreen();
    expect(submitWalletPin).not.toHaveBeenCalled();
    chooseAndSave('Save PIN', '4821', '4821');
    await screen.findByText('Enter your wallet PIN');
    expect(submitWalletPin).toHaveBeenCalledWith('set', '4821');
    expect(verifyFundPin).not.toHaveBeenCalled();
    expect(screen.getByLabelText('PIN').props.value).toBe('');
  });

  it('shows the server copy when saving fails', async () => {
    const message = 'Please sign in again to continue.';
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    jest
      .mocked(submitWalletPin)
      .mockRejectedValue(serverError(message, 'REAUTHENTICATION_REQUIRED'));
    renderSheet();
    await screen.findByText('Set a wallet PIN');
    chooseAndSave('Save PIN', '4821', '4821');
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('goes to PIN entry when the server says a PIN already exists', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    jest
      .mocked(submitWalletPin)
      .mockRejectedValue(
        serverError('A PIN is already set.', 'PIN_ALREADY_SET')
      );
    renderSheet();
    await screen.findByText('Set a wallet PIN');
    chooseAndSave('Save PIN', '4821', '4821');
    await screen.findByText('Enter your wallet PIN');
  });
});

describe('resetting a PIN', () => {
  it('uses the reset route when the server requires a reset', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ resetRequired: true }));
    jest.mocked(submitWalletPin).mockResolvedValue(undefined);
    renderSheet();
    await screen.findByText('Reset your wallet PIN');
    chooseAndSave('Reset PIN', '4821', '4821');
    await screen.findByText('Enter your wallet PIN');
    expect(submitWalletPin).toHaveBeenCalledWith('reset', '4821');
  });
});

describe('when the PIN service cannot be used', () => {
  it.each([
    ['not available', status({ available: false, hasPin: false })],
    ['not a primary customer', status({ primary: false })],
  ])('shows only the unavailable copy when %s', async (_name, answer) => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(answer);
    renderSheet();
    expect(
      await screen.findByText('Wallet PIN is unavailable right now')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Set a wallet PIN')).toBeNull();
    expect(screen.queryByLabelText('PIN')).toBeNull();
    expect(screen.queryByLabelText('New PIN')).toBeNull();
  });

  it('treats a failed status read as unavailable, never as set-a-PIN', async () => {
    jest.mocked(fetchWalletPinStatus).mockRejectedValue(new Error('network'));
    renderSheet();
    expect(
      await screen.findByText('Wallet PIN is unavailable right now')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Set a wallet PIN')).toBeNull();
  });
});
