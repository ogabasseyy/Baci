import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsPhonePickList } from './SavingsPhonePickList';

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2999-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Sandbox Test Phone',
} satisfies WalletActiveSavingsGoal;

describe('Change phone list, server off', () => {
  it('passes search text through and shows a load error calmly', () => {
    const onSearchChange = jest.fn();
    render(
      <SavingsPhonePickList
        colors={Colors.light}
        goal={goal}
        hiddenCount={0}
        loading={false}
        loadError="Couldn't load this phone's options. Please try again."
        onBack={jest.fn()}
        onPick={jest.fn()}
        onSearchChange={onSearchChange}
        rows={[]}
        searchValue=""
      />
    );
    fireEvent.changeText(screen.getByLabelText('Search phones'), 'galaxy');
    expect(onSearchChange).toHaveBeenCalledWith('galaxy');
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.queryByText(/are hidden/)).toBeNull();
  });
});
