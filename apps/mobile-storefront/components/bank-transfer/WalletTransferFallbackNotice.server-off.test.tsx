import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  WALLET_TRANSFER_FALLBACK_COPY,
  WALLET_TRANSFER_UNCONFIRMED_COPY,
  WalletTransferFallbackNotice,
} from './WalletTransferFallbackNotice';

describe('WalletTransferFallbackNotice', () => {
  it('tells the customer the order uses a one-time bank transfer', () => {
    render(
      <WalletTransferFallbackNotice colors={Colors.light} reason="piggyvest" />
    );

    expect(screen.getByText(WALLET_TRANSFER_FALLBACK_COPY)).toBeOnTheScreen();
  });

  it('uses calm copy, never an error', () => {
    expect(WALLET_TRANSFER_FALLBACK_COPY).toMatch(/one-time bank transfer/);
    expect(WALLET_TRANSFER_FALLBACK_COPY).not.toMatch(/error|failed/i);
    // By design for this order, not a passing outage (Muse).
    expect(WALLET_TRANSFER_FALLBACK_COPY).not.toMatch(/right now/i);
  });
});

describe('bugfix: an unconfirmed wallet described as "not available"', () => {
  it('says the wallet could not be confirmed when that caused the switch', () => {
    render(
      <WalletTransferFallbackNotice
        colors={Colors.light}
        reason="unconfirmed"
      />
    );

    expect(
      screen.getByText(WALLET_TRANSFER_UNCONFIRMED_COPY)
    ).toBeOnTheScreen();
    expect(screen.queryByText(WALLET_TRANSFER_FALLBACK_COPY)).toBeNull();
  });
});
