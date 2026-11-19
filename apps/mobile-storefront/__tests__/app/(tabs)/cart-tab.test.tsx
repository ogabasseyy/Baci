import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import CartTabScreen from '@/app/(tabs)/cart-tab';

jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

jest.mock('@/app/cart', () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return function MockCartScreen({
    onStartShopping,
  }: {
    onStartShopping?: () => void;
  }) {
    return (
      <Pressable accessibilityRole="button" onPress={onStartShopping}>
        <Text>Warm cart screen</Text>
      </Pressable>
    );
  };
});

describe('CartTabScreen', () => {
  it('passes the tab Home action through to the cart screen', () => {
    render(<CartTabScreen />);

    fireEvent.press(screen.getByRole('button'));

    expect(router.navigate).toHaveBeenCalledWith('/');
  });
});
