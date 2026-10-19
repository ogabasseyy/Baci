import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('completed unresolved savings device recovery', () => {
  it.each([
    undefined,
    [],
  ])('allows changing the device with resolution options %j without enabling top-ups', (options) => {
    const onChangeDevice = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{
          id: 'completed-unresolved',
          title: 'Unavailable device',
          current_amount: 100000,
          target_amount: 100000,
          contribution_amount: 10000,
          contribution_frequency: 'weekly',
          maturity_date: '2026-09-30',
          source_mode: 'manual',
          status: 'completed',
          selection_unresolved: true,
          variant_resolution_options: options,
        }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={onChangeDevice}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );

    expect(onChangeDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Resolve savings device variant' })
    ).toBeNull();
  });
});
