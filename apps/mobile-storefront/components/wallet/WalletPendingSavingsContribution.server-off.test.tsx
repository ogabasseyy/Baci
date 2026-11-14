import { act, fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';

// Status reads only: with PiggyVest off the card still re-checks by itself a
// few times and never starts a payment.
describe('pending contribution card with the server off', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('re-checks by itself every few seconds, then stops after six tries', () => {
    const onCheck = jest.fn();
    const card = (isChecking: boolean) => (
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={isChecking}
        onCheck={onCheck}
      />
    );
    const view = render(card(false));
    expect(onCheck).not.toHaveBeenCalled();
    // Each automatic check runs (isChecking true) then comes back still pending.
    for (let round = 0; round < 10; round += 1) {
      act(() => jest.advanceTimersByTime(5000));
      view.rerender(card(true));
      view.rerender(card(false));
    }
    expect(onCheck).toHaveBeenCalledTimes(6);
  });

  it('waits for a running check before asking again', () => {
    const onCheck = jest.fn();
    const view = render(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking
        onCheck={onCheck}
      />
    );
    act(() => jest.advanceTimersByTime(20000));
    expect(onCheck).not.toHaveBeenCalled();
    view.rerender(
      <WalletPendingSavingsContribution
        colors={Colors.light}
        isChecking={false}
        onCheck={onCheck}
      />
    );
    act(() => jest.advanceTimersByTime(5000));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('never runs a tap and the timer check at the same time', () => {
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
      />
    );
    fireEvent.press(getByRole('button', { name: 'Check contribution status' }));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onCheck).toHaveBeenCalledTimes(1);
    finish();
  });
});
