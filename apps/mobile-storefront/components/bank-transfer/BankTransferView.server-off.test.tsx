import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import Colors from '@/constants/Colors';
import { BankTransferView } from './BankTransferView';
import { WALLET_TRANSFER_FALLBACK_COPY } from './WalletTransferFallbackNotice';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));

const props = {
  accountName: 'Baci Store',
  accountNumber: '1234567890',
  amount: '250000',
  bankName: 'Test Bank',
  colors: Colors.light,
  copiedField: null,
  error: null,
  isSubmitting: false,
  isValid: true,
  onBack: jest.fn(),
  onConfirmTransfer: jest.fn(),
  onCopyAccountName: jest.fn(),
  onCopyAccountNumber: jest.fn(),
  onCopyBankName: jest.fn(),
};

describe('bugfix: payment method switched at Place Order without telling the customer', () => {
  it('explains the one-time bank transfer when wallet transfer was held', () => {
    // Arrange + Act: the final check switched to the per-order transfer.
    render(<BankTransferView {...props} walletTransferFallback="piggyvest" />);

    // Assert: a calm in-page notice, alongside the transfer details.
    expect(screen.getByText(WALLET_TRANSFER_FALLBACK_COPY)).toBeOnTheScreen();
    expect(screen.getByText('1234567890')).toBeOnTheScreen();
  });
});

describe('server keeps PiggyVest off', () => {
  it('shows no notice on an ordinary bank transfer', () => {
    render(<BankTransferView {...props} />);

    expect(screen.queryByText(WALLET_TRANSFER_FALLBACK_COPY)).toBeNull();
  });
});
