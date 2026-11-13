import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  WALLET_TRANSFER_FALLBACK_COPY,
  WalletTransferFallbackNotice,
} from './WalletTransferFallbackNotice';

describe('WalletTransferFallbackNotice', () => {
  it('tells the customer the order uses a one-time bank transfer', () => {
    render(<WalletTransferFallbackNotice colors={Colors.light} />);

    expect(screen.getByText(WALLET_TRANSFER_FALLBACK_COPY)).toBeOnTheScreen();
  });

  it('uses calm copy, never an error', () => {
    expect(WALLET_TRANSFER_FALLBACK_COPY).toMatch(/one-time bank transfer/);
    expect(WALLET_TRANSFER_FALLBACK_COPY).not.toMatch(/error|failed/i);
    // By design for this order, not a passing outage (Muse).
    expect(WALLET_TRANSFER_FALLBACK_COPY).not.toMatch(/right now/i);
  });
});
