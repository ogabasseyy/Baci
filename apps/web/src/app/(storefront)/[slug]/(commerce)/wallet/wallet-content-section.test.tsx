import { render, screen } from '@testing-library/react';
import { Children, isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SavingsScreen } from '@/components/storefront/piggyvest-savings/savings-screen';

vi.mock('@/components/storefront/ogabassey/pages/wallet', () => ({
  OgabasseyV2Wallet: ({
    initialShowFunding,
    initialShowUsdtFunding,
    initialUsdtAmount,
    initialUsdtReference,
    usdtWalletEnabled,
  }: {
    initialShowFunding?: boolean;
    initialShowUsdtFunding?: boolean;
    initialUsdtAmount?: number;
    initialUsdtReference?: string;
    usdtWalletEnabled?: boolean;
  }) => (
    <div
      data-initial-show-funding={String(initialShowFunding ?? false)}
      data-initial-show-usdt={String(initialShowUsdtFunding ?? false)}
      data-initial-usdt-amount={String(initialUsdtAmount ?? '')}
      data-initial-usdt-reference={String(initialUsdtReference ?? '')}
      data-usdt-wallet-enabled={String(usdtWalletEnabled ?? false)}
    >
      Wallet UI
    </div>
  ),
}));

import { WalletContentSection } from './wallet-content-section';

describe('WalletContentSection', () => {
  it.each([
    null,
    undefined,
    {
      environment: 'staging',
      status: 'loading',
      privateToken: 'synthetic-private',
    },
    { environment: 'staging', status: 'unavailable', submit: () => undefined },
    { environment: 'staging', status: 'ready', eligibility: null },
  ])('replaces invalid source before the client component serialization boundary', (stagingSavings) => {
    const output = WalletContentSection({
      stagingSavings,
      initialShowFunding: true,
    });
    const boundary = Children.toArray(output.props.children).find(
      (child) => isValidElement(child) && child.type === SavingsScreen
    );
    expect(isValidElement(boundary)).toBe(true);
    if (!isValidElement<{ source: unknown }>(boundary))
      throw new Error('Missing staging boundary');
    expect(boundary.props).toEqual({
      source: { environment: 'staging', status: 'unavailable' },
    });
  });

  it('passes a parsed DTO rather than the original object across the client boundary', () => {
    const source = { environment: 'staging', status: 'loading' };
    const output = WalletContentSection({ stagingSavings: source });
    const boundary = Children.toArray(output.props.children).find(
      (child) => isValidElement(child) && child.type === SavingsScreen
    );
    if (!isValidElement<{ source: unknown }>(boundary))
      throw new Error('Missing staging boundary');
    expect(boundary.props.source).toEqual(source);
    expect(boundary.props.source).not.toBe(source);
  });
  it.each([
    undefined,
    null,
    {},
    { environment: 'staging', status: 'ready', eligibility: null },
  ])('keeps present invalid staging input out of legacy wallet', (stagingSavings) => {
    render(
      <WalletContentSection
        stagingSavings={stagingSavings}
        initialShowFunding
      />
    );
    expect(screen.getByText('Staging savings are unavailable.')).toBeVisible();
    expect(screen.queryByText('Wallet UI')).toBeNull();
  });
  it.each([
    'loading',
    'unavailable',
    'unauthenticated',
  ] as const)('selects staging %s without falling back to legacy funding', (status) => {
    render(
      <WalletContentSection
        initialShowFunding
        initialShowUsdtFunding
        stagingSavings={{ environment: 'staging', status }}
      />
    );
    expect(
      screen.getByRole('region', { name: 'Staging savings journey' })
    ).toBeVisible();
    expect(screen.queryByText('Wallet UI')).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
  });

  it('accepts a serializable staging draft with exact device and disconnected consent', async () => {
    render(
      <WalletContentSection
        stagingSavings={{
          environment: 'staging',
          status: 'ready',
          sessionKey: 'synthetic-session',
          goalId: '10000000-0000-4000-8000-000000000001',
          policy: {
            status: 'draft',
            goalId: '10000000-0000-4000-8000-000000000001',
            revisionId: '20000000-0000-4000-8000-000000000001',
            device: {
              productName: 'Synthetic exact phone',
              variant: '256 GB / Blue',
              condition: 'Used',
            },
            terms: {
              version: 'synthetic-v1',
              hash: 'a'.repeat(64),
              text: 'Synthetic terms only.',
            },
            consent: 'required',
          },
          eligibility: { status: 'blocked' },
          funding: { status: 'unavailable' },
          progress: { status: 'unavailable' },
        }}
      />
    );
    expect(await screen.findByText('256 GB / Blue')).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByText('Wallet UI')).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
  });
  it('renders crawler-visible structure with an accessible page title', () => {
    render(<WalletContentSection />);

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Wallet Balance',
    });
    const section = heading.closest('section');

    expect(heading).toHaveClass('sr-only');
    expect(section).toHaveAttribute('aria-labelledby', 'wallet-page-title');
    expect(screen.getByText('Wallet UI')).toBeInTheDocument();
  });

  it('forwards USDT capability and redirected funding reference', () => {
    render(
      <WalletContentSection
        initialShowUsdtFunding
        initialUsdtReference="wusdt_ref_123456"
        usdtWalletEnabled
      />
    );

    expect(screen.getByText('Wallet UI')).toHaveAttribute(
      'data-initial-usdt-reference',
      'wusdt_ref_123456'
    );
    expect(screen.getByText('Wallet UI')).toHaveAttribute(
      'data-usdt-wallet-enabled',
      'true'
    );
  });

  it('forwards the funding deep-link state to the wallet UI', () => {
    render(<WalletContentSection initialShowFunding />);

    expect(screen.getByText('Wallet UI')).toHaveAttribute(
      'data-initial-show-funding',
      'true'
    );
  });

  it('forwards the USDT funding deep-link state and amount', () => {
    render(
      <WalletContentSection initialShowUsdtFunding initialUsdtAmount={65} />
    );

    expect(screen.getByText('Wallet UI')).toHaveAttribute(
      'data-initial-show-usdt',
      'true'
    );
    expect(screen.getByText('Wallet UI')).toHaveAttribute(
      'data-initial-usdt-amount',
      '65'
    );
  });
});
