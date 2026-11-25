import { describe, expect, it } from 'vitest';
import {
  isPreGatewayCreditStatus,
  sumActiveSavingsLedgerCredit,
  sumNetWalletLedgerCredit,
} from './store-credit-ledger';

describe('isPreGatewayCreditStatus', () => {
  it('treats unpaid, pending, and missing statuses as pre-gateway', () => {
    expect(isPreGatewayCreditStatus('unpaid')).toBe(true);
    expect(isPreGatewayCreditStatus('pending')).toBe(true);
    expect(isPreGatewayCreditStatus(' PENDING ')).toBe(true);
    expect(isPreGatewayCreditStatus(null)).toBe(true);
    expect(isPreGatewayCreditStatus(undefined)).toBe(true);
  });

  it('rejects settled or terminal statuses', () => {
    expect(isPreGatewayCreditStatus('paid')).toBe(false);
    expect(isPreGatewayCreditStatus('bnpl_approved')).toBe(false);
    expect(isPreGatewayCreditStatus('refunded')).toBe(false);
  });
});

describe('sumNetWalletLedgerCredit', () => {
  it('counts completed redemptions minus reversals and ignores non-completed redemptions', () => {
    expect(
      sumNetWalletLedgerCredit([
        {
          amount: 10000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
        {
          amount: 5000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'pending',
        },
        {
          amount: 4000,
          source_type: 'order_reversal',
          type: 'credit',
          status: 'completed',
        },
        {
          amount: 3000,
          source_type: 'order_reversal',
          type: 'credit',
          status: 'pending',
        },
        {
          amount: 2000,
          source_type: 'order_reversal',
          type: 'credit',
          status: 'failed',
        },
      ])
    ).toBe(6000);
  });

  it('clamps fully reversed redemptions to zero', () => {
    expect(
      sumNetWalletLedgerCredit([
        {
          amount: 15000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
        {
          amount: 15000,
          source_type: 'order_reversal',
          type: 'credit',
          status: 'completed',
        },
      ])
    ).toBe(0);
  });
});

describe('sumActiveSavingsLedgerCredit', () => {
  it('excludes savings rows whose metadata stamps reversed_at', () => {
    expect(
      sumActiveSavingsLedgerCredit([
        { amount: 5000, metadata: {} },
        {
          amount: 12000,
          metadata: { reversed_at: '2026-11-25T10:00:00Z' },
        },
        { amount: 2500, metadata: null },
      ])
    ).toBe(7500);
  });
});
