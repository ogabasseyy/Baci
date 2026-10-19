import { createPiggyvestCancellationController } from '@baci/shared/lib';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavingsScreen } from './savings-screen';

const goalId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId,
    device: {
      productName: 'Synthetic phone',
      variant: '256GB',
      condition: 'New',
    },
    terms: {
      version: 'synthetic',
      hash: 'a'.repeat(64),
      text: 'Synthetic terms',
    },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
} as const;
const quote = {
  status: 'quote_available',
  goalId,
  revisionId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};
function fixture() {
  const prepare = vi.fn(async () => {
    throw new Error('uncertain');
  });
  const controller = createPiggyvestCancellationController({
    source,
    quote,
    operationId,
    tenantKey: 'tenant',
    isCurrent: () => true,
    prepare,
  });
  return { controller, prepare };
}
describe('staging cancellation screen wiring', () => {
  it('shows cancellation independently of funding eligibility', async () => {
    const { controller } = fixture();
    render(<SavingsScreen source={source} cancellation={controller} />);
    expect(screen.getByText('Principal: NGN 100.00')).toBeVisible();
    await act(async () => undefined);
  });
  it('preserves omission and fails closed for invalid present input', async () => {
    const view = render(<SavingsScreen source={source} />);
    expect(screen.queryByText('Review cancellation preparation')).toBeNull();
    view.rerender(<SavingsScreen source={source} cancellation={null} />);
    expect(screen.getByText('Cancellation is unavailable.')).toBeVisible();
    await act(async () => undefined);
  });
  it.each([
    'session',
    'goal',
    'revision',
    'terms',
    'variant',
  ])('rejects changed %s source with no cancellation dispatch', async (field) => {
    const { controller, prepare } = fixture();
    const view = render(
      <SavingsScreen source={source} cancellation={controller} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    const changed = {
      ...source,
      sessionKey: field === 'session' ? 'other' : source.sessionKey,
      goalId: field === 'goal' ? revisionId : goalId,
      policy: {
        ...source.policy,
        goalId: field === 'goal' ? revisionId : goalId,
        revisionId: field === 'revision' ? goalId : revisionId,
        terms: {
          ...source.policy.terms,
          hash: field === 'terms' ? 'b'.repeat(64) : source.policy.terms.hash,
        },
        device: {
          ...source.policy.device,
          variant: field === 'variant' ? '128GB' : '256GB',
        },
      },
    };
    view.rerender(<SavingsScreen source={changed} cancellation={controller} />);
    expect(screen.queryByText('Principal: NGN 100.00')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => undefined);
  });
  it('retains uncertainty across remount without creating or resending an operation', async () => {
    const { controller, prepare } = fixture();
    const view = render(
      <SavingsScreen source={source} cancellation={controller} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Prepare cancellation' })
      );
    });
    view.unmount();
    render(<SavingsScreen source={source} cancellation={controller} />);
    expect(
      screen.queryByRole('button', { name: 'Prepare cancellation' })
    ).toBeNull();
    expect(screen.getByText(/Reservation may be retained/)).toBeVisible();
    expect(prepare).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
  });
});
