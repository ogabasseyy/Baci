import { render, screen } from '@testing-library/react-native';
import { WalletHeroStartSavingsButton } from './WalletHeroStartSavingsButton';

describe('WalletHeroStartSavingsButton (server off)', () => {
  it('renders without any network dependency', () => {
    render(<WalletHeroStartSavingsButton onPress={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Start Savings' })
    ).toBeOnTheScreen();
  });
});
