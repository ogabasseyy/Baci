import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsGoalConditionArtwork } from './SavingsGoalConditionArtwork';

jest.mock('./SavingsGoalArtwork', () => ({
  SavingsGoalArtwork: () => null,
}));

const goal = (product_condition: string | null): WalletActiveSavingsGoal =>
  ({
    id: 'goal-1',
    title: 'Phone',
    product_condition,
  }) as WalletActiveSavingsGoal;

it('shows the stored device condition badge without relying on a new server verdict', () => {
  render(
    <SavingsGoalConditionArtwork
      colors={Colors.light}
      goal={goal('used')}
      imageRequestSize={160}
      size={120}
    />
  );

  expect(screen.getByLabelText('Device condition: Used')).toBeOnTheScreen();
});

it('omits the condition badge when a legacy goal has no condition', () => {
  render(
    <SavingsGoalConditionArtwork
      colors={Colors.light}
      goal={goal(null)}
      imageRequestSize={160}
      size={120}
    />
  );

  expect(screen.queryByLabelText(/^Device condition:/)).toBeNull();
});

describe('bugfix: the New badge covered the phone icon on small artwork', () => {
  it('puts the badge under small artwork instead of over it', () => {
    render(
      <SavingsGoalConditionArtwork
        colors={Colors.light}
        goal={goal('new')}
        imageRequestSize={128}
        size={52}
      />
    );
    const badge = screen.getByLabelText('Device condition: New');
    expect(badge).not.toHaveStyle({ position: 'absolute' });
  });

  it('keeps the corner badge on large artwork', () => {
    render(
      <SavingsGoalConditionArtwork
        colors={Colors.light}
        goal={goal('new')}
        imageRequestSize={160}
        size={120}
      />
    );
    expect(screen.getByLabelText('Device condition: New')).toHaveStyle({
      position: 'absolute',
    });
  });
});
