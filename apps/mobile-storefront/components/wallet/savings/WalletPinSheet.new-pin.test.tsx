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
import type { PinProofRequest } from '@/lib/wallet-pin-proof';
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

function renderSheet(open: PinProofRequest = request) {
  const onProof = jest.fn();
  const onCancel = jest.fn();
  render(
    <WalletPinSheet
      colors={Colors.light}
      request={open}
      onProof={onProof}
      onCancel={onCancel}
    />
  );
  return { onProof, onCancel };
}

/** Taps the in-sheet number pad, one digit at a time. */
function typePin(pin: string) {
  for (const digit of pin)
    fireEvent.press(screen.getByRole('button', { name: digit }));
}

function chooseAndSave(button: string, newPin: string, confirm: string) {
  typePin(newPin);
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  typePin(confirm);
  fireEvent.press(screen.getByRole('button', { name: button }));
}

beforeEach(() => jest.resetAllMocks());

describe('setting a PIN', () => {
  it('asks for a matching confirmation, saves, then approves with the new PIN straight away', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    jest.mocked(submitWalletPin).mockResolvedValue(undefined);
    jest.mocked(verifyFundPin).mockResolvedValue(proof);
    const { onProof } = renderSheet();
    await screen.findByText('Create your wallet PIN');
    chooseAndSave('Save PIN', '4821', '4822');
    expect(
      await screen.findByText('The two PINs do not match.')
    ).toBeOnTheScreen();
    expect(submitWalletPin).not.toHaveBeenCalled();
    chooseAndSave('Save PIN', '4821', '4821');
    await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof));
    expect(submitWalletPin).toHaveBeenCalledWith('set', '4821', undefined);
    expect(verifyFundPin).toHaveBeenCalledWith(
      { ...request, pin: '4821' },
      undefined
    );
  });

  it('shows the server copy when saving fails', async () => {
    const message = 'PIN setup is temporarily unavailable.';
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    jest
      .mocked(submitWalletPin)
      .mockRejectedValue(serverError(message, 'PIN_UNAVAILABLE'));
    renderSheet();
    await screen.findByText('Create your wallet PIN');
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
    await screen.findByText('Create your wallet PIN');
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
    expect(submitWalletPin).toHaveBeenCalledWith('reset', '4821', undefined);
  });
});
