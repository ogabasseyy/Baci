import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsBottomSheet } from '../SavingsBottomSheet';
import { SavingsVariantPickStep } from './SavingsVariantPickStep';

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 650000,
  id: 'goal-1',
  maturity_date: '2026-11-01',
  selection_unresolved: true,
  source_mode: 'manual',
  status: 'completed',
  target_amount: 650000,
  title: 'iPhone 15',
} satisfies WalletActiveSavingsGoal;
const options = [
  { id: 'v1', label: '128GB Black' },
  { id: 'v2', label: '256GB Blue' },
];

function renderStep(onResolve: (id: string) => Promise<true | string>) {
  const onBack = jest.fn();
  render(
    <SavingsVariantPickStep
      colors={Colors.light}
      goal={goal}
      onBack={onBack}
      onResolve={onResolve}
      options={options}
    />
  );
  return onBack;
}

describe('Choose your exact phone, server off', () => {
  it('saves once even when Confirm is tapped twice before it re-renders', async () => {
    const onResolve = jest.fn(
      (): Promise<true | string> => new Promise(() => undefined)
    );
    renderStep(onResolve);
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    // Both presses land in one batch, before React re-renders with pending.
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm this option',
    });
    act(() => {
      fireEvent.press(confirmButton);
      fireEvent.press(confirmButton);
    });
    await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
  });

  it('keeps the savings sheet open while the choice saves', async () => {
    let finish: (value: true) => void = () => undefined;
    const onResolve = jest.fn(
      () =>
        new Promise<true | string>((resolve) => {
          finish = resolve;
        })
    );
    render(
      <SavingsBottomSheet colors={Colors.light} onClose={jest.fn()} visible>
        <SavingsVariantPickStep
          colors={Colors.light}
          goal={goal}
          onBack={jest.fn()}
          onResolve={onResolve}
          options={options}
        />
      </SavingsBottomSheet>
    );
    const sheet = () => screen.getByTestId('gorhom-bottom-sheet');
    expect(sheet().props.enablePanDownToClose).toBe(true);
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    await waitFor(() => expect(sheet().props.enablePanDownToClose).toBe(false));
    finish(true);
    await waitFor(() => expect(sheet().props.enablePanDownToClose).toBe(true));
  });

  it('keeps Confirm off until an option is picked', () => {
    const onResolve = jest.fn(async (): Promise<true | string> => true);
    renderStep(onResolve);
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('radio', { name: '256GB Blue' }));
    expect(screen.getByRole('radio', { name: '256GB Blue' })).toBeChecked();
  });

  it('saves the picked option once and goes back on success', async () => {
    const onResolve = jest.fn(async (): Promise<true | string> => true);
    const onBack = renderStep(onResolve);
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(onResolve).toHaveBeenCalledWith('v1');
  });

  it('shows a refusal inline instead of an alert', async () => {
    const onResolve = jest.fn(
      async (): Promise<true | string> =>
        'That option is no longer available. Pull to refresh and try again.'
    );
    const onBack = renderStep(onResolve);
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That option is no longer available. Pull to refresh and try again.'
    );
    expect(onBack).not.toHaveBeenCalled();
  });

  it('says so calmly when the network fails', async () => {
    renderStep(async () => {
      throw new Error('offline');
    });
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't save your choice. Please try again."
    );
  });

  it("starts fresh for another store and ignores the old store's late reply", async () => {
    let finish: (value: true | string) => void = () => undefined;
    const onResolve = jest.fn(
      () =>
        new Promise<true | string>((resolve) => {
          finish = resolve;
        })
    );
    act(() => {
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        merchantId: 'm-1',
      });
    });
    const onBack = renderStep(onResolve);
    fireEvent.press(screen.getByRole('radio', { name: '128GB Black' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm this option' })
    );
    act(() => {
      useAuthStore.setState({ merchantId: 'm-2' });
    });
    expect(
      screen.getByRole('radio', { name: '128GB Black' }).props
        .accessibilityState.checked
    ).toBe(false);
    await act(async () => {
      finish('Old store says no');
    });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByText('Old store says no')).toBeNull();
  });
});
