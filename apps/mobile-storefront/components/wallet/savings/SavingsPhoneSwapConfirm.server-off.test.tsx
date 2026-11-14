import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import { SavingsPhoneSwapConfirm } from './SavingsPhoneSwapConfirm';

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 120000,
  id: 'goal-1',
  maturity_date: '2999-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Sandbox Test Phone',
} satisfies WalletActiveSavingsGoal;
const product = {
  id: 'p',
  name: 'iPhone 15',
  price: 780000,
  slug: 'p',
  image: '',
} satisfies Product;
const row = {
  image: '',
  key: 'p:default',
  meta: [],
  price: 780000,
  product,
  title: 'iPhone 15',
  variantId: null,
  variantLabel: null,
};

describe('Change phone confirm, server off', () => {
  it('shows what moves over, the new goal and the new pace to the same end date', () => {
    render(
      <SavingsPhoneSwapConfirm
        colors={Colors.light}
        goal={goal}
        onConfirm={jest.fn()}
        onKeep={jest.fn()}
        pending={false}
        row={row}
      />
    );
    expect(screen.getByText('Your savings move over')).toBeOnTheScreen();
    expect(screen.getByText('₦120,000')).toBeOnTheScreen();
    expect(screen.getByText('₦780,000')).toBeOnTheScreen();
    expect(screen.getByText(/To finish by 1 Jan 2999/)).toBeOnTheScreen();
    expect(screen.getByText(/a week$/)).toBeOnTheScreen();
  });

  it('names the exact option before anything changes', () => {
    render(
      <SavingsPhoneSwapConfirm
        colors={Colors.light}
        goal={goal}
        onConfirm={jest.fn()}
        onKeep={jest.fn()}
        pending={false}
        row={{ ...row, meta: ['Used', 'Storage: 256GB'] }}
      />
    );
    expect(screen.getByText('Used · Storage: 256GB')).toBeOnTheScreen();
  });

  it('only the chosen button acts', () => {
    const onConfirm = jest.fn();
    const onKeep = jest.fn();
    render(
      <SavingsPhoneSwapConfirm
        colors={Colors.dark}
        goal={goal}
        onConfirm={onConfirm}
        onKeep={onKeep}
        pending={false}
        row={row}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Keep Sandbox Test Phone' })
    );
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
