import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FundingDetails } from './funding-details';
import type { FundingDetailsProps } from './funding-details.types';

const account = {
  bankName: 'Synthetic Test Bank',
  accountName: 'Synthetic Account Alpha',
  accountNumber: '0000000123',
};
const ready = {
  status: 'ready',
  accounts: [account],
} satisfies FundingDetailsProps;

describe('FundingDetails', () => {
  it('renders multiple accounts without mixing their details', () => {
    const secondAccount = {
      bankName: 'Synthetic Second Bank',
      accountName: 'Synthetic Account Beta',
      accountNumber: '0000000456',
    };
    render(
      <FundingDetails status="ready" accounts={[account, secondAccount]} />
    );

    expect(
      screen.getAllByRole('definition').map((detail) => detail.textContent)
    ).toEqual([
      account.bankName,
      account.accountName,
      account.accountNumber,
      secondAccount.bankName,
      secondAccount.accountName,
      secondAccount.accountNumber,
    ]);
  });

  it('renders the exact sanitized account details as accessible read-only text', () => {
    render(<FundingDetails {...ready} />);

    const card = screen.getByRole('region', { name: 'Funding details' });
    expect(
      within(card).getByRole('heading', { name: 'Funding details' })
    ).toBeVisible();
    expect(
      within(card)
        .getAllByRole('term')
        .map((term) => term.textContent)
    ).toEqual(['Bank', 'Account name', 'Account number']);
    expect(
      within(card)
        .getAllByRole('definition')
        .map((detail) => detail.textContent)
    ).toEqual([account.bankName, account.accountName, account.accountNumber]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Test funding details available.'
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it.each([
    'loading',
    'pending',
    'unavailable',
    'ready',
  ] as const)('always labels %s as staging with an explicit test-environment notice', (status) => {
    render(<FundingDetails {...ready} status={status} />);

    expect(screen.getByText('Staging')).toBeVisible();
    expect(
      screen.getByText(
        'Test environment only. Do not send real money to these details.'
      )
    ).toBeVisible();
    expect(
      screen.queryByText(/fee|interest|guarantee|refund|withdraw/i)
    ).toBeNull();
  });

  it.each([
    ['loading', 'Loading test funding details…'],
    ['pending', 'Test funding details are pending confirmation.'],
    ['unavailable', 'Test funding details are unavailable.'],
  ] as const)('removes stale details immediately on %s', (status, message) => {
    const { rerender } = render(<FundingDetails {...ready} />);

    rerender(<FundingDetails {...ready} status={status} />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.queryByRole('definition')).toBeNull();
    for (const value of Object.values(account)) {
      expect(screen.queryByText(value)).toBeNull();
    }
  });

  it('clears previous customer details while the parent loads the next customer', () => {
    const { rerender } = render(<FundingDetails {...ready} />);

    rerender(<FundingDetails status="loading" />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading test funding details…'
    );
    expect(screen.queryByRole('definition')).toBeNull();
    expect(screen.queryByText(account.accountNumber)).toBeNull();

    rerender(
      <FundingDetails
        status="ready"
        accounts={[
          {
            bankName: 'Synthetic Second Bank',
            accountName: 'Synthetic Account Beta',
            accountNumber: '0000000456',
          },
        ]}
      />
    );

    expect(screen.getByText('0000000456')).toBeVisible();
    expect(screen.queryByText(account.accountNumber)).toBeNull();
  });

  it('does not render extra provider fields into the DOM', () => {
    const props = {
      ...ready,
      accounts: [
        {
          ...account,
          paypoint_name: 'private-paypoint-name',
          paypoint_id: 'private-paypoint-id',
          providerWalletId: 'private-wallet-id',
          providerCustomerId: 'private-customer-id',
        },
      ],
    };
    const { container } = render(<FundingDetails {...props} />);

    expect(container.innerHTML).not.toMatch(/private-/);
    expect(screen.getByText(account.accountNumber)).toBeVisible();
  });

  it('renders markup-shaped text literally without creating elements', () => {
    const { container } = render(
      <FundingDetails
        {...ready}
        accounts={[{ ...account, accountName: '<img src=x onerror=alert(1)>' }]}
      />
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows unavailable for an empty ready account list', () => {
    render(<FundingDetails status="ready" accounts={[]} />);

    expect(screen.queryByRole('definition')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Test funding details are unavailable.'
    );
  });

  it('accepts a JSON round-trip of the serializable props', () => {
    const serialized: FundingDetailsProps = JSON.parse(JSON.stringify(ready));
    render(<FundingDetails {...serialized} />);

    expect(screen.getByText(account.accountNumber)).toBeVisible();
  });
});
