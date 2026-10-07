import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavingsScreen } from './savings-screen';
import type { SavingsScreenSource } from './savings-screen.types';

function source(): Extract<SavingsScreenSource, { status: 'ready' }> {
  return {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'synthetic-session',
    goalId: '10000000-0000-4000-8000-000000000001',
    policy: {
      status: 'draft',
      goalId: '10000000-0000-4000-8000-000000000001',
      revisionId: '20000000-0000-4000-8000-000000000001',
      device: {
        productName: 'Synthetic phone',
        variant: '256 GB / Blue',
        condition: 'Used',
      },
      terms: {
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text: 'Synthetic review terms only.',
      },
      consent: 'accepted',
    },
    eligibility: {
      status: 'allowed',
      sessionKey: 'synthetic-session',
      goalId: '10000000-0000-4000-8000-000000000001',
      revisionId: '20000000-0000-4000-8000-000000000001',
      termsHash: 'a'.repeat(64),
      termsVersion: 'synthetic-v1',
    },
    funding: {
      status: 'ready',
      accounts: [
        {
          accountName: 'Synthetic',
          accountNumber: 'NOT-A-BANK-ACCOUNT',
          bankName: 'Synthetic Bank',
        },
      ],
    },
    progress: {
      status: 'ready',
      decision: {
        purchasingPowerKobo: 10000,
        devicePriceKobo: 10000,
        readiness: 'ready_for_review',
        purchaseAction: 'requires_customer_confirmation',
      },
      pendingInterestKobo: 500,
    },
  };
}

describe('SavingsScreen', () => {
  it.each([
    null,
    {},
    { status: 'ready' },
    { ...source(), eligibility: null },
    { ...source(), sessionKey: 42 },
    { ...source(), progress: null },
    { ...source(), funding: null },
    { ...source(), privateToken: 'private' },
    { ...source(), progress: { status: 'ready', decision: {} } },
  ])('fails closed on malformed full source without retaining account details', async (invalid) => {
    const { rerender } = render(<SavingsScreen source={source()} />);
    await screen.findByText('NOT-A-BANK-ACCOUNT');
    rerender(<SavingsScreen source={invalid} />);
    expect(screen.getByText('Staging savings are unavailable.')).toBeVisible();
    expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Customer savings' })
    ).toBeNull();
  });
  it('rejects mismatched policy goals and malformed terms without showing funding', () => {
    const current = source();
    const { rerender } = render(
      <SavingsScreen
        source={{ ...current, goalId: '10000000-0000-4000-8000-000000000002' }}
      />
    );
    expect(screen.getByText('Staging savings are unavailable.')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
    rerender(
      <SavingsScreen
        source={{
          ...current,
          policy: {
            ...current.policy,
            terms: { ...current.policy.terms, hash: 'invalid' },
          },
        }}
      />
    );
    expect(
      screen.queryByRole('region', { name: 'Draft policy review' })
    ).toBeNull();
  });

  it.each([
    'pending',
    'unavailable',
  ] as const)('renders actual funding %s for an eligible snapshot', async (status) => {
    render(<SavingsScreen source={{ ...source(), funding: { status } }} />);
    expect(
      await screen.findByText(
        status === 'pending'
          ? 'Test funding details are pending confirmation.'
          : 'Test funding details are unavailable.'
      )
    ).toBeVisible();
    expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
  });
  it('renders actual panels for eligible accepted server snapshots with purchase blocked', async () => {
    render(<SavingsScreen source={source()} />);
    expect(await screen.findByText('NOT-A-BANK-ACCOUNT')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Draft policy review' })
    ).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Customer savings' })
    ).toBeVisible();
    expect(screen.getAllByText('256 GB / Blue').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Review purchase' })
    ).toBeNull();
    expect(screen.getAllByText('₦100.00')).toHaveLength(2);
  });

  it.each([
    'loading',
    'unavailable',
    'unauthenticated',
  ] as const)('hides details in %s state', async (status) => {
    const { rerender } = render(<SavingsScreen source={source()} />);
    await screen.findByText('NOT-A-BANK-ACCOUNT');
    rerender(<SavingsScreen source={{ environment: 'staging', status }} />);
    expect(screen.queryByText('NOT-A-BANK-ACCOUNT')).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Customer savings' })
    ).toBeNull();
    expect(screen.getByRole('status')).toBeVisible();
  });

  it.each([
    'blocked',
    'pending',
    'unavailable',
  ] as const)('hides funding and progress when eligibility is %s', async (status) => {
    render(<SavingsScreen source={{ ...source(), eligibility: { status } }} />);
    await screen.findByText('Consent recorded for this draft.');
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Customer savings' })
    ).toBeNull();
  });

  it.each([
    'sessionKey',
    'goalId',
    'revisionId',
    'termsHash',
    'termsVersion',
  ] as const)('rejects stale eligibility %s', (field) => {
    const current = source();
    if (current.eligibility.status !== 'allowed')
      throw new Error('Invalid fixture');
    render(
      <SavingsScreen
        source={{
          ...current,
          eligibility: { ...current.eligibility, [field]: 'stale' },
        }}
      />
    );
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Customer savings' })
    ).toBeNull();
  });

  it('keeps unaccepted drafts read-only without a client transport binding', async () => {
    const current = source();
    render(
      <SavingsScreen
        source={{
          ...current,
          policy: { ...current.policy, consent: 'required' },
        }}
      />
    );
    expect(await screen.findByRole('checkbox')).toBeDisabled();
    expect(
      screen.getByText('Consent submission is not connected.')
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
  });

  it('does not unlock funding from a successful client acceptance alone', async () => {
    const current = source();
    const policy = { ...current.policy, consent: 'required' as const };
    const submitPolicy = vi.fn(async () => ({
      ...policy,
      consent: 'accepted',
    }));
    render(
      <SavingsScreen
        source={{ ...current, policy }}
        submitPolicy={submitPolicy}
      />
    );
    fireEvent.click(await screen.findByRole('checkbox'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Accept draft terms' })
      )
    );
    expect(screen.getByText('Consent recorded for this draft.')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Funding details' })
    ).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Customer savings' })
    ).toBeNull();
  });
});
