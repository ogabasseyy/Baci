import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletScreenHeader } from './WalletScreenHeader';

describe('WalletScreenHeader', () => {
  it('shows the title with no back button on the tab', () => {
    render(
      <WalletScreenHeader colors={Colors.light} title="Wallet & Loyalty" />
    );

    expect(
      screen.getByRole('header', { name: 'Wallet & Loyalty' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });

  it('offers a back button on the stacked page', () => {
    const onBack = jest.fn();
    render(
      <WalletScreenHeader
        colors={Colors.light}
        onBack={onBack}
        title="Wallet & Loyalty"
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
