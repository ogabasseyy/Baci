import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ProfileRewardsCard } from './ProfileRewardsCard';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('ProfileRewardsCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the points formatted and opens the wallet from Redeem', () => {
    render(<ProfileRewardsCard loyaltyPoints={12500} />);

    expect(screen.getByText(/12,500|12\.500|12500/)).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'View wallet and redeem points' })
    );
    expect(router.push).toHaveBeenCalledWith('/wallet');
  });

  it('dims Redeem while pressed and restores it when the tap navigates', () => {
    render(<ProfileRewardsCard loyaltyPoints={0} />);
    const redeem = screen.getByRole('button', {
      name: 'View wallet and redeem points',
    });

    fireEvent(redeem, 'pressIn');
    expect(redeem).toHaveStyle({ opacity: 0.8 });
    fireEvent.press(redeem);
    expect(redeem).not.toHaveStyle({ opacity: 0.8 });
  });
});
