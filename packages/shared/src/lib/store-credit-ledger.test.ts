import { describe, expect, it } from 'vitest';
import {
  computeOrderNetPayable,
  computeOrderPreGatewayPaid,
  isPreGatewayCreditStatus,
  sumActiveSavingsLedgerCredit,
  summarizeWalletLedgerCredit,
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

describe('summarizeWalletLedgerCredit & computeOrderNetPayable', () => {
  it('flags completed reversals and ignores stale order columns when reversed', () => {
    const summary = summarizeWalletLedgerCredit([
      {
        amount: 20000,
        source_type: 'order_redemption',
        type: 'redemption',
        status: 'completed',
      },
      {
        amount: 20000,
        source_type: 'order_reversal',
        type: 'credit',
        status: 'completed',
      },
    ]);
    expect(summary).toEqual({
      netCredit: 0,
      reversedCredit: 20000,
      hasCompletedReversal: true,
    });

    expect(
      computeOrderPreGatewayPaid({
        total: 50000,
        amountPaid: 20000,
        walletAmountUsed: 20000,
        walletLedgerUsed: summary.netCredit,
        savingsLedgerUsed: 5000,
        paymentStatus: 'unpaid',
        walletReversalCompleted: summary.hasCompletedReversal,
      })
    ).toBe(5000);

    expect(
      computeOrderNetPayable({
        total: 50000,
        amountPaid: 20000,
        walletAmountUsed: 20000,
        walletLedgerUsed: summary.netCredit,
        savingsLedgerUsed: 5000,
        paymentStatus: 'unpaid',
        walletReversalCompleted: summary.hasCompletedReversal,
      })
    ).toBe(45000);
  });

  it('subtracts genuine gateway amountPaid on partially_paid orders while still excluding reversed wallet credit', () => {
    expect(
      computeOrderNetPayable({
        total: 50000,
        amountPaid: 30000,
        walletAmountUsed: 10000,
        walletLedgerUsed: 10000,
        savingsLedgerUsed: 5000,
        paymentStatus: 'partially_paid',
        walletReversalCompleted: false,
      })
    ).toBe(20000);

    expect(
      computeOrderNetPayable({
        total: 50000,
        amountPaid: 40000,
        walletAmountUsed: 20000,
        walletLedgerUsed: 0,
        walletReversedCredit: 20000,
        savingsLedgerUsed: 0,
        paymentStatus: 'partially_paid',
        walletReversalCompleted: true,
      })
    ).toBe(30000);
  });

  it('caps pre-gateway credit at order total when amountPaid and ledger columns overlap', () => {
    expect(
      computeOrderPreGatewayPaid({
        total: 50000,
        amountPaid: 40000,
        walletAmountUsed: 30000,
        walletLedgerUsed: 30000,
        savingsLedgerUsed: 30000,
        paymentStatus: 'unpaid',
      })
    ).toBe(50000);
  });
});
