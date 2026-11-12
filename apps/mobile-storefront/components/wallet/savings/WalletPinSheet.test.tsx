import { createHash } from 'node:crypto';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { TextInput } from 'react-native';
import Colors from '@/constants/Colors';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
  verifyGoalActionPin,
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

const digitsEntered = (label: string, count: number) =>
  screen.getByLabelText(`${label}, ${count} of 6 digits entered`);

beforeEach(() => jest.resetAllMocks());

describe('entering the PIN', () => {
  it('verifies the fund action for this goal, operation and amount and hands back the proof', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest.mocked(verifyFundPin).mockResolvedValue(proof);
    const { onProof } = renderSheet();
    await screen.findByText('Enter your wallet PIN');
    typePin('4821');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof));
    expect(verifyFundPin).toHaveBeenCalledWith(
      { ...request, pin: '4821' },
      undefined
    );
    expect(digitsEntered('PIN', 0)).toBeOnTheScreen();
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
    typePin('0000');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('That PIN is not right.')).toBeOnTheScreen();
    expect(digitsEntered('PIN', 0)).toBeOnTheScreen();
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
    typePin('1234');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(locked)).toBeOnTheScreen();
  });

  it('does not call the server for a PIN that is not 4 to 6 digits', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    await screen.findByText('Enter your wallet PIN');
    typePin('12');
    expect(digitsEntered('PIN', 2)).toBeOnTheScreen();
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
    expect(screen.queryByText('Create your wallet PIN')).toBeNull();
    expect(screen.queryByLabelText(/^PIN, /)).toBeNull();
    expect(screen.queryByLabelText(/^New PIN, /)).toBeNull();
  });

  it('treats a failed status read as unavailable, never as set-a-PIN', async () => {
    jest.mocked(fetchWalletPinStatus).mockRejectedValue(new Error('network'));
    renderSheet();
    expect(
      await screen.findByText('Wallet PIN is unavailable right now')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Create your wallet PIN')).toBeNull();
  });
});

describe('number pad', () => {
  it('uses its own number pad, never the phone keyboard', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    await screen.findByText('Enter your wallet PIN');
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
    typePin('482');
    fireEvent.press(screen.getByRole('button', { name: 'Delete digit' }));
    expect(digitsEntered('PIN', 2)).toBeOnTheScreen();
  });

  it('asks for at least four digits before the confirm step', async () => {
    jest
      .mocked(fetchWalletPinStatus)
      .mockResolvedValue(status({ hasPin: false }));
    renderSheet();
    await screen.findByText('Create your wallet PIN');
    typePin('482');
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter 4 to 6 digits.')).toBeOnTheScreen();
    expect(screen.getByText('Choose 4 to 6 digits.')).toBeOnTheScreen();
    expect(submitWalletPin).not.toHaveBeenCalled();
  });

  it('turns the button red only once four digits are in', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    await screen.findByText('Enter your wallet PIN');
    const confirm = () => screen.getByRole('button', { name: 'Confirm' });
    expect(confirm()).toHaveStyle({ backgroundColor: Colors.light.muted });
    typePin('4821');
    expect(confirm()).toHaveStyle({ backgroundColor: Colors.light.primary });
  });

  it('says what the PIN is for', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    expect(
      await screen.findByText('Adding ₦2,500 to savings')
    ).toBeOnTheScreen();
  });
});

describe('goal actions', () => {
  const goalIds = {
    merchantId: request.merchantId,
    goalId: request.goalId,
    operationId: request.operationId,
  };

  it('keeps the contribution copy for the fund action', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    renderSheet();
    expect(
      await screen.findByText('Confirm this contribution with your PIN.')
    ).toBeOnTheScreen();
  });

  it.each([
    ['cancel', 'Enter your PIN to cancel this goal.'],
    ['complete', 'Enter your PIN to complete this goal.'],
  ] as const)('shows the %s copy and verifies that action without an amount', async (action, copy) => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest.mocked(verifyGoalActionPin).mockResolvedValue(proof);
    const { onProof } = renderSheet({ ...goalIds, action });
    expect(await screen.findByText(copy)).toBeOnTheScreen();
    typePin('4821');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof));
    expect(verifyGoalActionPin).toHaveBeenCalledWith(
      { ...goalIds, action, pin: '4821' },
      undefined
    );
    expect(verifyFundPin).not.toHaveBeenCalled();
  });

  it('switches to set / reset from a goal-action check, as the fund path does', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue(status({}));
    jest
      .mocked(verifyGoalActionPin)
      .mockRejectedValue(serverError('Set a PIN first.', 'PIN_NOT_SET'));
    renderSheet({ ...goalIds, action: 'cancel' });
    await screen.findByText('Enter your PIN to cancel this goal.');
    typePin('4821');
    fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Create your wallet PIN')).toBeOnTheScreen();
  });
});
