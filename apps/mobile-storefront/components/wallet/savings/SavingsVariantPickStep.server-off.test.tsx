import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
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
});
