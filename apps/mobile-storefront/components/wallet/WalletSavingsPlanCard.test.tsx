import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import Colors, { BRAND } from '@/constants/Colors';
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
  it('reads its action colour from the central brand configuration', () => {
    const replacement = jest.replaceProperty(
      BRAND,
      'primary',
      Colors.light.success
    );
    try {
      render(
        <WalletSavingsPlanCard
          colors={Colors.dark}
          goal={goal}
          onOpen={jest.fn()}
        />
      );
      expect(
        screen.getByRole('button', { name: 'Add to savings for iPhone 15 Pro' })
      ).toHaveStyle({ backgroundColor: Colors.light.success });
    } finally {
      replacement.restore();
    }
  });

  it('shows a created but unfunded plan without claiming progress', () => {
    const onOpen = jest.fn();
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={onOpen}
      />
    );

    expect(screen.queryByText('Every naira counts')).toBeNull();
    expect(screen.queryByText('SAVED')).toBeNull();
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
    expect(screen.getByText('Ends 30 October 2026')).toBeOnTheScreen();
    expect(screen.queryByText(/50%/)).toBeNull();
    expect(screen.queryByText(/to go/)).toBeNull();
  });

  it('does not announce goal completion until the full target is saved', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{ ...goal, current_amount: 99500 }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.queryByText('Almost there!')).toBeNull();
    expect(screen.queryByText('Goal reached!')).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ now: 99 });
  });

  it('recognizes a small saved amount below one percent of the target', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{ ...goal, current_amount: 400, target_amount: 250000 }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.queryByText('Your plan is growing')).toBeNull();
    expect(screen.queryByText('Every naira counts')).toBeNull();
    expect(screen.getByText('Ends 30 October 2026')).toBeOnTheScreen();
    expect(screen.queryByText(/<1%/)).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress' })
    ).toHaveAccessibilityValue({ now: 0 });
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

  it('offers moving the savings for a funded goal awaiting settlement', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={{ ...goal, current_amount: 100000, status: 'completed' }}
        awaitingSettlement
        onOpen={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', {
        name: 'Move your savings for iPhone 15 Pro',
      })
    ).toBeOnTheScreen();
    expect(screen.queryByText('Start another plan')).toBeNull();
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
          product_variant_label: 'Storage: 256GB · Blue',
          product_condition: 'used',
        }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.getByText('256GB')).toBeOnTheScreen();
    expect(screen.queryByText(/Storage:/)).toBeNull();
    expect(screen.getByLabelText('Device condition: Used')).toBeOnTheScreen();
    expect(
      screen.getByRole('image', { name: 'Device colour: Blue' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('Blue')).toBeNull();
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
    expect(rendered).toContain(BRAND.primary);
    expect(rendered).not.toContain(Colors.light.cardForeground);
  });

  it('gives the dark mode Add to savings CTA a static horizontal red glow', () => {
    const onOpen = jest.fn();
    const { UNSAFE_getByType } = render(
      <WalletSavingsPlanCard colors={Colors.dark} goal={goal} onOpen={onOpen} />
    );

    expect(UNSAFE_getByType(LinearGradient).props).toEqual(
      expect.objectContaining({
        colors: [BRAND.primaryDark, BRAND.primary, BRAND.primaryDark],
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
      })
    );
    const button = screen.getByRole('button', {
      name: 'Add to savings for iPhone 15 Pro',
    });
    fireEvent(button, 'focus');
    expect(StyleSheet.flatten(button.props.style)).toEqual(
      expect.objectContaining({ borderColor: BRAND.onPrimary, borderWidth: 2 })
    );
    fireEvent.press(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: the card invited a first contribution while the plan was being set up', () => {
  it('shows the setup state and a View plan action while the plan is getting ready', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={jest.fn()}
        setupState="getting_ready"
      />
    );
    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    expect(screen.queryByText('Start with your first contribution')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'View plan for iPhone 15 Pro' })
    ).toBeOnTheScreen();
    expect(screen.UNSAFE_queryByType(LinearGradient)).toBeNull();
  });

  it('asks to finish setup when it never started', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={jest.fn()}
        setupState="needs_setup"
      />
    );
    expect(screen.getByText('Finish setting up your plan')).toBeOnTheScreen();
  });

  it('still invites the first contribution once the plan is ready', () => {
    render(
      <WalletSavingsPlanCard
        colors={Colors.light}
        goal={goal}
        onOpen={jest.fn()}
      />
    );
    expect(
      screen.getByText('Start with your first contribution')
    ).toBeOnTheScreen();
  });
});
