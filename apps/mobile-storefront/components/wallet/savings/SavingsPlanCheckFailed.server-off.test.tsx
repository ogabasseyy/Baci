import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanCheckFailed } from './SavingsPlanCheckFailed';

// Pure presentation: with PiggyVest switched off the status read fails, and
// this card must still show that each Try again is a new attempt.
describe('SavingsPlanCheckFailed with PiggyVest off', () => {
  afterEach(() => jest.useRealTimers());

  it('shows Checking… and disables the button while the new read runs', async () => {
    let finish: () => void = () => undefined;
    const onTryAgain = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(
      <SavingsPlanCheckFailed colors={Colors.light} onTryAgain={onTryAgain} />
    );

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(onTryAgain).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole('button', { name: 'Checking' });
    expect(busy).toBeDisabled();
    expect(screen.getByText('Checking…')).toBeOnTheScreen();
    fireEvent.press(busy);
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('shows a fresh "Last tried" time after a repeat failure', async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 14, 9, 5) });
    const onTryAgain = jest.fn(async () => {
      throw new Error('offline');
    });
    render(
      <SavingsPlanCheckFailed colors={Colors.light} onTryAgain={onTryAgain} />
    );
    expect(screen.getByText('Last tried 09:05')).toBeOnTheScreen();

    jest.setSystemTime(new Date(2026, 10, 14, 9, 7));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(screen.getByText('Last tried 09:07')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
