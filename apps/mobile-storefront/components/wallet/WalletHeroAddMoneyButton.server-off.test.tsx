import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletHeroAddMoneyButton } from './WalletHeroAddMoneyButton';

describe('WalletHeroAddMoneyButton', () => {
  it('opens the transfer instructions when pressed', () => {
    const onPress = jest.fn();
    render(<WalletHeroAddMoneyButton onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Add money' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing until pressed', () => {
    const onPress = jest.fn();
    render(<WalletHeroAddMoneyButton onPress={onPress} />);

    expect(screen.getByText('Add money')).toBeOnTheScreen();
    expect(onPress).not.toHaveBeenCalled();
  });
});
