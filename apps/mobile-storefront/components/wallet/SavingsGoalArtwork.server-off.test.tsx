import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { SavingsGoalArtwork } from './SavingsGoalArtwork';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    Image: ({
      accessibilityLabel,
      onError,
    }: {
      accessibilityLabel?: string;
      onError?: () => void;
    }) => (
      <View
        {...{ onError }}
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
  it('falls back to device artwork when a product image fails', () => {
    const view = render(
      <SavingsGoalArtwork
        colors={Colors.dark}
        goal={{ ...goal, product_image: 'https://cdn.example.com/missing.jpg' }}
        imageRequestSize={170}
        size={80}
      />
    );
    fireEvent(screen.getByRole('image', { name: 'iPhone 15 Pro' }), 'error');
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro savings goal' })
    ).toBeOnTheScreen();
    view.rerender(
      <SavingsGoalArtwork
        colors={Colors.dark}
        goal={{
          ...goal,
          product_image: 'https://cdn.example.com/replacement.jpg',
        }}
        imageRequestSize={170}
        size={80}
      />
    );
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: /savings goal/ })).toBeNull();
  });

  it('allows an explicit retry after a transient failure and preserves fallback on another failure', () => {
    render(
      <SavingsGoalArtwork
        colors={Colors.dark}
        goal={{ ...goal, product_image: 'https://cdn.example.com/retry.jpg' }}
        imageRequestSize={170}
        size={80}
      />
    );
    fireEvent(screen.getByRole('image', { name: 'iPhone 15 Pro' }), 'error');
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry photo for iPhone 15 Pro' })
    );
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro' })
    ).toBeOnTheScreen();
    fireEvent(screen.getByRole('image', { name: 'iPhone 15 Pro' }), 'error');
    expect(
      screen.getByRole('image', { name: 'iPhone 15 Pro savings goal' })
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Retry photo for iPhone 15 Pro' })
    ).toBeOnTheScreen();
  });
});
