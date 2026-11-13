import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletPaySheetState } from './use-wallet-pay-sheet';
import { WalletPaySheet } from './WalletPaySheet';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? children : null),
}));

function sheetState(
  overrides: Partial<WalletPaySheetState<string>> = {}
): WalletPaySheetState<string> {
  return {
    step: 'enter',
    pin: '',
    setPin: jest.fn(),
    error: null,
    outcome: null,
    amountKobo: 30_000,
    busy: false,
    open: jest.fn(),
    nextSession: jest.fn(() => () => true),
    submit: jest.fn(async () => undefined),
    recheck: jest.fn(async () => undefined),
    close: jest.fn(),
    back: jest.fn(),
    retryStart: jest.fn(async () => undefined),
    ...overrides,
  };
}

function renderSheet(sheet: WalletPaySheetState<string>) {
  const onOpenWallet = jest.fn();
  const onSignIn = jest.fn();
  render(
    <WalletPaySheet
      colors={Colors.light}
      purchase="IMEI check"
      sheet={sheet}
      onOpenWallet={onOpenWallet}
      onSignIn={onSignIn}
    />
  );
  return { onOpenWallet, onSignIn };
}

describe('WalletPaySheet', () => {
  it('asks for the PIN in the sheet with what is being paid', () => {
    const sheet = sheetState({ pin: '1234' });
    renderSheet(sheet);
    expect(screen.getByText('Enter your wallet PIN')).toBeOnTheScreen();
    expect(
      screen.getByText('Paying ₦300 for your IMEI check')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: '5' }));
    expect(sheet.setPin).toHaveBeenCalledWith('12345');

    fireEvent.press(screen.getByRole('button', { name: 'Pay ₦300' }));
    expect(sheet.submit).toHaveBeenCalledTimes(1);
  });

  it('shows a wrong PIN under the dots', () => {
    renderSheet(sheetState({ error: 'That PIN is not right. 2 tries left.' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That PIN is not right. 2 tries left.'
    );
  });

  it('cannot be closed while the payment is being sent', () => {
    renderSheet(sheetState({ step: 'paying' }));
    expect(
      screen.getByText('Paying from your savings wallet...')
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('shows a refund as a calm card, refunded exactly once', () => {
    const sheet = sheetState({
      step: 'outcome',
      outcome: { kind: 'refunded' },
    });
    renderSheet(sheet);
    expect(screen.getByTestId('wallet-pay-notice')).toHaveTextContent(
      /₦300 is going back to your savings wallet\. It is refunded exactly once/
    );
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(sheet.close).toHaveBeenCalled();
  });

  it('offers to check again while PiggyVest confirms', () => {
    const sheet = sheetState({ step: 'outcome', outcome: { kind: 'pending' } });
    renderSheet(sheet);
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(sheet.recheck).toHaveBeenCalledTimes(1);
  });

  it('sends a customer with no PIN to the wallet', () => {
    const { onOpenWallet } = renderSheet(
      sheetState({ step: 'outcome', outcome: { kind: 'pin_setup' } })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Open wallet' }));
    expect(onOpenWallet).toHaveBeenCalled();
  });

  it('bugfix: keeps Pay disabled for a PIN longer than 6 digits (Muse)', () => {
    renderSheet(sheetState({ pin: '1234567' }));
    expect(
      screen.getByRole('button', { name: 'Pay ₦300' }).props.accessibilityState
    ).toMatchObject({ disabled: true });
  });

  it('keeps Pay disabled until the PIN has 4 digits', () => {
    const sheet = sheetState({ pin: '12' });
    renderSheet(sheet);
    const pay = screen.getByRole('button', { name: 'Pay ₦300' });
    expect(pay).toBeDisabled();
    fireEvent.press(pay);
    expect(sheet.submit).not.toHaveBeenCalled();
  });

  it('bugfix: a start that failed reads neutral, names no provider and shows its title once (Fable F7)', () => {
    const sheet = sheetState({
      step: 'outcome',
      outcome: { kind: 'not_started' },
    });
    renderSheet(sheet);
    expect(screen.getAllByText("We couldn't start this purchase")).toHaveLength(
      1
    );
    expect(screen.getByTestId('wallet-pay-notice')).toHaveTextContent(
      'Nothing was taken from your savings wallet. Please try again.'
    );
    expect(screen.queryByText(/PiggyVest|connection/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(sheet.retryStart).toHaveBeenCalledTimes(1);
  });

  it('cannot be closed while the PIN is being checked', () => {
    renderSheet(sheetState({ pin: '', busy: true }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
