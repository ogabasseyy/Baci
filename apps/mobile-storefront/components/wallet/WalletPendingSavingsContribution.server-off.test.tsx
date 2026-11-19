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

  it('asks once per tap and logs a failed check instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onCheck = jest.fn(() => Promise.reject(new Error('server off')));
    const { getByRole } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    fireEvent.press(getByRole('button', { name: 'Check contribution status' }));
    await act(async () => {});
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('also catches a check that throws synchronously', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onCheck = jest.fn(() => {
      throw new Error('boom');
    });
    const { getByRole } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    expect(() =>
      fireEvent.press(
        getByRole('button', { name: 'Check contribution status' })
      )
    ).not.toThrow();
    await act(async () => {});
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

  it('says Retry, not Check, when the button sends the same request again', () => {
    const { getByRole, getByText } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={jest.fn()}
        retry
      />
    );
    expect(getByRole('button', { name: 'Retry contribution' })).toBeTruthy();
    expect(getByText(/won't be charged twice/)).toBeTruthy();
  });

  it('bugfix (Codex): a fast double tap starts the retry only once', async () => {
    let finish: () => void = () => undefined;
    const onCheck = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { getByRole } = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
        retry
      />
    );
    const button = getByRole('button', { name: 'Retry contribution' });
    fireEvent.press(button);
    fireEvent.press(button);
    await act(async () => {});
    expect(onCheck).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.press(button);
    await act(async () => {});
    expect(onCheck).toHaveBeenCalledTimes(2);
  });
});
