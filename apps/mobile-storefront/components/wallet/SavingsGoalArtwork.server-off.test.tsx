import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      />
    ),
  };
});

const goal = {
  id: 'g',
  product_image: null,
  title: 'iPhone 15 Pro',
} as WalletActiveSavingsGoal;

describe('SavingsGoalArtwork', () => {
  it('shows a friendly themed tile instead of "No Image" when there is no photo', () => {
    render(
      <SavingsGoalArtwork
        colors={Colors.light}
        goal={goal}
        imageRequestSize={170}
        size={96}
      />
    );
    expect(screen.queryByText(/no image/i)).toBeNull();
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro savings goal' })
    ).toBeOnTheScreen();
  });

  it('shows the product photo when one exists', () => {
    render(
      <SavingsGoalArtwork
        colors={Colors.dark}
        goal={{ ...goal, product_image: 'https://cdn.example.com/p.jpg' }}
        imageRequestSize={170}
        size={96}
      />
    );
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: /savings goal/ })).toBeNull();
  });
});
