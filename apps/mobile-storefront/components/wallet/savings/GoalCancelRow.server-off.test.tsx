import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { GoalCancelRow } from './GoalCancelRow';

describe('cancel breakdown row with the server off', () => {
  it('shows lost interest crossed out', () => {
    render(
      <GoalCancelRow
        colors={Colors.light}
        label="Interest (not refunded)"
        value={1240}
        struck
      />
    );
    expect(screen.getByText('₦1,240')).toHaveStyle({
      textDecorationLine: 'line-through',
    });
  });

  it('shows money that comes back without a strike', () => {
    render(
      <GoalCancelRow
        colors={Colors.light}
        label="Back to your wallet"
        value={120000}
        total
      />
    );
    expect(screen.getByText('₦120,000')).not.toHaveStyle({
      textDecorationLine: 'line-through',
    });
  });
});
