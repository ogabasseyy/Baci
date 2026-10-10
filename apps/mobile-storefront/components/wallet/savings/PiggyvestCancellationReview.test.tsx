import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestCancellationReview as CancellationReview } from './PiggyvestCancellationReview';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

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
async function accept() {
  await act(async () => {
    fireEvent.press(screen.getByRole('checkbox'));
  });
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
  });
}

describe('isolated cancellation review', () => {
  it('does not submit without explicit confirmation and collapses same-tick duplicate taps', async () => {
    const onPrepare = jest.fn(() => new Promise(() => undefined));
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    expect(onPrepare).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByRole('checkbox'));
    });
    const button = screen.getByRole('button', { name: 'Prepare cancellation' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });
  it.each([
    false,
    true,
  ])('accepts a lowercase receipt for uppercase operation and uppercase goal=%s without rewriting the command', async (uppercaseGoal) => {
    const goal = 'abcdefab-1111-4111-8111-111111111111';
    const operation = 'abcdefab-2222-4222-8222-222222222222';
    const onPrepare = jest.fn(async () => ({
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
    await accept();
    expect(onPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: operation.toUpperCase() })
    );
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Prepared only\. Not refunded\./
    );
  });
  it('does not unlock an uncertain operation by changing UUID casing', async () => {
    const operation = 'abcdefab-2222-4222-8222-222222222222';
    const onPrepare = jest.fn(async () => {
      throw new Error('uncertain');
    });
    const view = render(
      <CancellationReview
        {...props}
        operationId={operation.toUpperCase()}
        onPrepare={onPrepare}
      />
    );
    await accept();
    view.rerender(
      <CancellationReview
        {...props}
        operationId={operation}
        onPrepare={onPrepare}
      />
    );
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Reservation may be retained/
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
    const onPrepare = jest.fn(async () => result);
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    await accept();
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Reservation may be retained/
    );
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });
  it('clears the quote and suppresses completion after logout', async () => {
    let complete: (value: unknown) => void = () => undefined;
    const onPrepare = jest.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const view = render(
      <CancellationReview {...props} onPrepare={onPrepare} />
    );
    await accept();
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
    const onPrepare = jest.fn(async () => receipt);
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    expect(screen.getByText('Principal: NGN 100.00')).toBeOnTheScreen();
    expect(screen.getByText('Paid interest: NGN 1.00')).toBeOnTheScreen();
    expect(screen.getByText('Pending interest: NGN 2.00')).toBeOnTheScreen();
    expect(screen.getByText(/Cancellation fee: 0%/)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    await accept();
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
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Prepared only\. Not refunded\./
    );
  });
  it.each([
    null,
    { ...quote, goalId: operationId },
    { ...quote, actorId: goalId },
    { ...quote, consentVersion: 'unknown' },
    { status: 'unavailable', goalId },
  ])('disables preparation for invalid or unavailable quote %j', (value) => {
    render(
      <CancellationReview
        {...props}
        quote={value}
        onPrepare={jest.fn(async () => undefined)}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('never retries uncertainty or claims reservation release', async () => {
    const onPrepare = jest.fn(async () => {
      throw new Error('private');
    });
    render(<CancellationReview {...props} onPrepare={onPrepare} />);
    await accept();
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Reservation may be retained/
    );
    expect(screen.queryByText('private')).toBeNull();
  });
  it.each([
    'amount',
    'operation',
    'terms',
    'goal',
    'session',
    'callback',
  ])('suppresses old success and resets consent when %s changes', async (change) => {
    let complete: (value: unknown) => void = () => undefined;
    const onPrepare = jest.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const view = render(
      <CancellationReview {...props} onPrepare={onPrepare} />
    );
    await accept();
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
    expect(onPrepare).toHaveBeenCalledTimes(1);
    view.rerender(
      <CancellationReview
        {...props}
        sessionKey={change === 'session' ? 'new-session' : props.sessionKey}
        goalId={change === 'goal' ? operationId : goalId}
        operationId={change === 'operation' ? goalId : operationId}
        quote={
          change === 'amount'
            ? { ...quote, principalKobo: 20000 }
            : change === 'terms'
              ? { ...quote, termsHash: 'b'.repeat(64) }
              : change === 'goal'
                ? { ...quote, goalId: operationId }
                : quote
        }
        onPrepare={
          change === 'callback' ? jest.fn(async () => undefined) : onPrepare
        }
      />
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibilityState({
      checked: false,
    });
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
    await accept();
    expect(screen.getByTestId('cancellation-status')).toHaveTextContent(
      /Reservation may be retained/
    );
  });
});
