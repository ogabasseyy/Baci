import { jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  WalletFundPhonePrompt,
  type WalletFundPhoneSubmitResult,
} from './WalletFundPhonePrompt';

function renderPrompt(
  onSubmit: (phone: string) => Promise<WalletFundPhoneSubmitResult> = jest.fn(
    async () => ({ success: true })
  )
) {
  render(<WalletFundPhonePrompt colors={Colors.light} onSubmit={onSubmit} />);
  return { onSubmit };
}

describe('WalletFundPhonePrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a clear account setup form when Add Money needs a phone number', () => {
    renderPrompt();

    expect(screen.getByText('Set up bank transfer')).toBeOnTheScreen();
    expect(screen.getByText('PHONE NUMBER')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Save phone number' })
    ).toHaveStyle({
      minHeight: 56,
    });
  });

  it('submits the trimmed phone number when valid', async () => {
    const onSubmit = jest.fn<
      (phone: string) => Promise<WalletFundPhoneSubmitResult>
    >(async () => ({ success: true }));
    renderPrompt(onSubmit);

    fireEvent.changeText(
      screen.getByLabelText('Phone number'),
      ' 08012345678 '
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('08012345678');
    });
  });

  it('shows an inline error and does not submit when the number is too short', () => {
    const onSubmit = jest.fn<
      (phone: string) => Promise<WalletFundPhoneSubmitResult>
    >(async () => ({ success: true }));
    renderPrompt(onSubmit);

    fireEvent.changeText(screen.getByLabelText('Phone number'), '0801');
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    expect(screen.getByText('Valid phone number required')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('surfaces the save error and allows a retry after failure', async () => {
    const onSubmit = jest
      .fn<(phone: string) => Promise<WalletFundPhoneSubmitResult>>()
      .mockResolvedValueOnce({ success: false, error: 'Session expired.' })
      .mockResolvedValueOnce({ success: true });
    renderPrompt(onSubmit);

    fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    expect(await screen.findByText('Session expired.')).toBeTruthy();

    // Retry succeeds with the same input.
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a fallback error when saving rejects', async () => {
    const onSubmit = jest.fn<
      (phone: string) => Promise<WalletFundPhoneSubmitResult>
    >(async () => {
      throw new Error('network down');
    });
    renderPrompt(onSubmit);

    fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
    fireEvent.press(screen.getByRole('button', { name: 'Save phone number' }));

    expect(
      await screen.findByText(/could not save your phone number/i)
    ).toBeTruthy();
  });
});
