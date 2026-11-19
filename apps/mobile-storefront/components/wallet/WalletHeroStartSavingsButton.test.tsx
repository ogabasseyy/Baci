import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletHeroStartSavingsButton } from './WalletHeroStartSavingsButton';

describe('WalletHeroStartSavingsButton', () => {
  it('starts the savings flow when pressed', () => {
    const onPress = jest.fn();
    render(<WalletHeroStartSavingsButton onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Start Savings' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
