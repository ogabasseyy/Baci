import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import Colors, { palette } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 10000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2026-10-30',
  source_mode: 'manual',
  status: 'active',
  target_amount: 100000,
  title: 'iPhone 15 Pro',
};

describe('WalletSavingsPlanCard', () => {
  it('shows a created but unfunded plan without claiming progress', () => {
    const onOpen = jest.fn();
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={onOpen}
      />
    );

    expect(screen.getByText('Your plan is ready')).toBeOnTheScreen();
    expect(
      screen.getByText('Start with your first contribution')
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ now: 0 });
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Add to savings for iPhone 15 Pro',
      })
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows only server-supplied savings progress and remaining amount', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{ ...goal, current_amount: 50000 }}
        onOpen={jest.fn()}
      />
    );

    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ now: 50 });
    expect(screen.getByText('50% · 30 October 2026')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000 to go')).toBeOnTheScreen();
  });

  it('labels the completed-plan action as starting another plan', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{ ...goal, current_amount: 100000, status: 'completed' }}
        onOpen={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', {
        name: 'Start another plan for iPhone 15 Pro',
      })
    ).toBeOnTheScreen();
  });

  it('opens auto-debit plan details without offering a manual savings transfer', () => {
    const { UNSAFE_queryByType } = render(
      <WalletSavingsPlanCard
        colors={Colors.dark}
        goal={{ ...goal, source_mode: 'auto_debit' }}
        onOpen={jest.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'View plan for iPhone 15 Pro' })
    ).toBeOnTheScreen();
    expect(UNSAFE_queryByType(LinearGradient)).toBeNull();
  });

  it('shows the exact selected variant and its product image', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{
          ...goal,
          product_image: 'https://example.com/phone.jpg',
          product_variant_label: '256GB · Blue',
        }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.getByText('256GB · Blue')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Add to savings for iPhone 15 Pro' })
    ).toBeOnTheScreen();
  });

  it('uses dark theme surfaces and readable text when dark mode is active', () => {
    const { toJSON } = render(
      <WalletSavingsPlanCard
        colors={Colors.dark}
        goal={goal}
        onOpen={jest.fn()}
      />
    );

    const rendered = JSON.stringify(toJSON());
    expect(rendered).toContain(Colors.dark.card);
    expect(rendered).toContain(Colors.dark.cardForeground);
    expect(rendered).toContain(Colors.dark.primary);
    expect(rendered).not.toContain(Colors.light.cardForeground);
  });

  it('gives the dark mode Add to savings CTA a static horizontal amber glow', () => {
    const onOpen = jest.fn();
    const { UNSAFE_getByType } = render(
      <WalletSavingsPlanCard colors={Colors.dark} goal={goal} onOpen={onOpen} />
    );

    expect(UNSAFE_getByType(LinearGradient).props).toEqual(
      expect.objectContaining({
        colors: [palette.amber[600], palette.amber[400], palette.amber[600]],
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
      })
    );
    const button = screen.getByRole('button', {
      name: 'Add to savings for iPhone 15 Pro',
    });
    fireEvent(button, 'focus');
    expect(StyleSheet.flatten(button.props.style)).toEqual(
      expect.objectContaining({ borderColor: palette.black, borderWidth: 2 })
    );
    fireEvent.press(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
