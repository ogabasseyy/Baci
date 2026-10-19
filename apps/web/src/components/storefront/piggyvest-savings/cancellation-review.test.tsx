import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CancellationReview } from './cancellation-review';

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const quote = {
  status: 'quote_available',
  goalId,
  revisionId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};
const receipt = {
  status: 'prepared',
  goalId,
  operationId,
  collectionPaused: true,
  dispatch: 'contract_gap',
  interestDisposition: 'unresolved',
};
const props = { sessionKey: 'synthetic-session', goalId, operationId, quote };
function accept() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare cancellation' }));
}

describe('isolated cancellation review', () => {
  it('dispatches once when two clicks occur before React commits pending state', async () => {
    const onPrepare = vi.fn(() => new Promise<never>(() => undefined));
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    fireEvent.click(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: 'Prepare cancellation' });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });
  it.each([
    false,
    true,
  ])('accepts a lowercase receipt for uppercase operation and uppercase goal=%s without rewriting the command', async (uppercaseGoal) => {
    const goal = 'abcdefab-1111-4111-8111-111111111111';
    const operation = 'abcdefab-2222-4222-8222-222222222222';
    const onPrepare = vi.fn(async () => ({
      ...receipt,
      goalId: goal,
      operationId: operation,
    }));
    render(
      <CancellationReview
        {...props}
        goalId={uppercaseGoal ? goal.toUpperCase() : goal}
        operationId={operation.toUpperCase()}
        quote={{ ...quote, goalId: goal }}
        onPrepare={onPrepare}
      />
    );
    await act(async () => {
      accept();
    });
    expect(onPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: operation.toUpperCase() })
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Prepared only. Not refunded.'
    );
  });
  it('does not unlock an uncertain operation by changing UUID casing', async () => {
    const operation = 'abcdefab-2222-4222-8222-222222222222';
    const onPrepare = vi.fn(async () => {
      throw new Error('uncertain');
    });
    const view = render(
      <CancellationReview
        {...props}
        operationId={operation.toUpperCase()}
        onPrepare={onPrepare}
      />
    );
    await act(async () => {
      accept();
    });
    view.rerender(
      <CancellationReview
        {...props}
        operationId={operation}
        onPrepare={onPrepare}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reservation may be retained'
    );
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...receipt, goalId: operationId },
    { ...receipt, refunded: true },
    {
      status: 'unavailable',
      goalId,
      operationId,
      reservation: 'may_be_retained',
      dispatch: 'contract_gap',
    },
  ])('keeps uncertain receipt blocked without retry %j', async (result) => {
    const onPrepare = vi.fn(async () => result);
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    await act(async () => {
      accept();
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reservation may be retained'
    );
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });
  it('clears the quote and suppresses completion after logout', async () => {
    let complete: (value: unknown) => void = () => undefined;
    const onPrepare = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const view = render(
      <CancellationReview {...props} onPrepare={onPrepare} />
    );
    accept();
    view.rerender(
      <CancellationReview {...props} sessionKey={null} onPrepare={onPrepare} />
    );
    await act(async () => {
      complete(receipt);
    });
    expect(screen.queryByText('Principal: NGN 100.00')).toBeNull();
    expect(screen.queryByText(/Prepared only/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('shows principal and interest separately with explicit unrefunded preparation', async () => {
    const onPrepare = vi.fn(async () => receipt);
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    expect(screen.getByText('Principal: NGN 100.00')).toBeVisible();
    expect(screen.getByText('Paid interest: NGN 1.00')).toBeVisible();
    expect(screen.getByText('Pending interest: NGN 2.00')).toBeVisible();
    expect(screen.getByText(/Cancellation fee: 0%/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    await act(async () => {
      accept();
    });
    expect(onPrepare).toHaveBeenCalledWith({
      goalId,
      operationId,
      revisionId: goalId,
      termsVersion: quote.termsVersion,
      termsHash: quote.termsHash,
      consentVersion: quote.consentVersion,
      principalKobo: 10000,
      paidInterestKobo: 100,
      pendingInterestKobo: 200,
      accepted: true,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Prepared only. Not refunded.'
    );
  });
  it.each([
    null,
    { ...quote, goalId: operationId },
    { ...quote, actorId: goalId },
    { ...quote, consentVersion: 'unknown' },
    { status: 'unavailable', goalId },
  ])('disables preparation for invalid or unavailable quote %j', (value) => {
    render(<CancellationReview {...props} quote={value} onPrepare={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('never retries uncertainty or claims reservation release', async () => {
    const onPrepare = vi.fn(async () => {
      throw new Error('private');
    });
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    await act(async () => {
      accept();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reservation may be retained'
    );
    expect(screen.queryByText('private')).toBeNull();
  });
  it.each([
    'amount',
    'terms',
    'goal',
    'session',
    'callback',
  ])('suppresses old success and resets consent when %s changes', async (change) => {
    let complete: (value: unknown) => void = () => undefined;
    const onPrepare = vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const view = render(
      <CancellationReview {...props} onPrepare={onPrepare} />
    );
    accept();
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    expect(onPrepare).toHaveBeenCalledTimes(1);
    view.rerender(
      <CancellationReview
        {...props}
        sessionKey={change === 'session' ? 'new-session' : props.sessionKey}
        goalId={change === 'goal' ? operationId : goalId}
        quote={
          change === 'amount'
            ? { ...quote, principalKobo: 20000 }
            : change === 'terms'
              ? { ...quote, termsHash: 'b'.repeat(64) }
              : change === 'goal'
                ? { ...quote, goalId: operationId }
                : quote
        }
        onPrepare={change === 'callback' ? vi.fn() : onPrepare}
      />
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await act(async () => {
      complete(receipt);
    });
    expect(screen.queryByText(/Prepared only/)).toBeNull();
  });
  it('rejects a mismatched receipt operation', async () => {
    render(
      <CancellationReview
        {...props}
        onPrepare={async () => ({ ...receipt, operationId: goalId })}
      />
    );
    await act(async () => {
      accept();
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reservation may be retained'
    );
  });
});
