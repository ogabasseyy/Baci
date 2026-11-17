import { act, fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';

// Status reads only: with the savings server off the card never starts a
// payment. Its automatic re-checks moved to the wallet screen's polling
// (usePendingSavingsStatusPolling), so the card itself never polls.
describe('pending contribution card with the server off', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not poll by itself', () => {
    const onCheck = jest.fn();
    render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    act(() => jest.advanceTimersByTime(10 * 60_000));
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('asks once per tap and swallows a failed check', () => {
    const onCheck = jest.fn(() => Promise.reject(new Error('server off')));
    const { getByRole } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    fireEvent.press(getByRole('button', { name: 'Check contribution status' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('shows Checking and ignores taps while a check runs', () => {
    const onCheck = jest.fn();
    const { getByRole, getByText } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking
        onCheck={onCheck}
      />
    );
    expect(getByText('Checking contribution…')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: 'Check contribution status' }));
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('is disabled without a status check to run', () => {
    const { getByRole } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
      />
    );
    expect(
      getByRole('button', { name: 'Check contribution status' })
    ).toBeDisabled();
  });
});
