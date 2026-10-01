import type { StorefrontWallet } from '@baci/shared';
import { render } from '@testing-library/react';
import type { SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { WalletPageFundingPanel } from './WalletPageFundingPanel';

const capturedProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => null,
}));

vi.mock('./WalletFundingPanel', () => ({
  WalletFundingPanel: (props: Record<string, unknown>) => {
    capturedProps.current = props;
    return <div data-testid="wallet-funding-panel" />;
  },
}));

function baseWallet(overrides: Partial<StorefrontWallet> = {}): StorefrontWallet {
  return {
    balance: 5000,
    fundingAccount: {
      accountName: 'Ogabassey/Jane',
      accountNumber: '1234567890',
      bankName: 'Titan',
      provider: 'paystack',
    },
    requiresFundingAccountConsent: true,
    transactions: [
      { amount: 5000, created_at: '2026-05-21', id: 'txn-1', type: 'credit' },
    ],
    walletDvaEnabled: true,
    ...overrides,
  } as unknown as StorefrontWallet;
}

describe('WalletPageFundingPanel', () => {
  it('wires the wallet account, baseline transactions, and wallet-page surface through', () => {
    render(
      <WalletPageFundingPanel
        customerId="customer-1"
        customerPhone="08012345678"
        merchantSlug="ogabassey"
        onRefresh={vi.fn()}
        setWallet={vi.fn()}
        wallet={baseWallet()}
      />
    );

    const props = capturedProps.current;
    expect(props?.account).toMatchObject({ accountNumber: '1234567890' });
    expect(props?.walletTransactions).toHaveLength(1);
    expect(props?.surface).toBe(
      WALLET_FUNDING_TELEMETRY.surfaces.walletPage
    );
    // The panel owns the point-of-need phone collection, so the consent gate
    // remains enabled when the DVA feature is available.
    expect(props?.requiresConsent).toBe(true);
  });

  it('passes the no-phone state through so the panel can collect it at point of need', () => {
    render(
      <WalletPageFundingPanel
        customerId="customer-1"
        customerPhone="   "
        merchantSlug="ogabassey"
        onRefresh={vi.fn()}
        setWallet={vi.fn()}
        wallet={baseWallet()}
      />
    );

    expect(capturedProps.current?.requiresConsent).toBe(true);
  });

  it('patches wallet state (clearing the consent flag) when an account is created', () => {
    let stored: StorefrontWallet | null = baseWallet({
      fundingAccount: null,
      requiresFundingAccountConsent: true,
    });
    const setWallet = vi.fn((action: SetStateAction<StorefrontWallet | null>) => {
      stored =
        typeof action === 'function'
          ? (action as (c: StorefrontWallet | null) => StorefrontWallet | null)(
              stored
            )
          : action;
    });

    render(
      <WalletPageFundingPanel
        customerId="customer-1"
        customerPhone="08012345678"
        merchantSlug="ogabassey"
        onRefresh={vi.fn()}
        setWallet={setWallet}
        wallet={stored}
      />
    );

    const onAccountCreated = capturedProps.current?.onAccountCreated as (
      account: unknown
    ) => void;
    onAccountCreated({
      accountName: 'New',
      accountNumber: '9999999999',
      bankName: 'Titan',
      provider: 'paystack',
    });

    expect(stored?.fundingAccount).toMatchObject({
      accountNumber: '9999999999',
    });
    expect(stored?.requiresFundingAccountConsent).toBe(false);
  });
});
