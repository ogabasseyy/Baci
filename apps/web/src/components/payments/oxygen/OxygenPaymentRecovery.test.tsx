import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) =>
    fetch(...(args as Parameters<typeof fetch>)),
}));

import { OxygenPaymentRecovery } from './OxygenPaymentRecovery';

const workflow = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const state = {
  reference,
  paymentComplete: false,
  setupComplete: true,
  paymentUrl: 'https://payment.hydrogenpay.com/?transactionId=synthetic',
  setupUrl: null,
  checkedAt: '2026-10-24T17:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
  resendBlocked: false,
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('restores the saved payment link on reopen without issuing another link or approval', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
      approvalUnconfirmed
    />
  );
  const button = await screen.findByRole('button', {
    name: 'Continue to payment',
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByTitle('Oxygen secure payment')).toHaveAttribute(
    'src',
    state.paymentUrl
  );
  expect(screen.queryByRole('button', { name: /Get a new/ })).toBeNull();
  expect(screen.getByText('Repayment setup complete')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.method).not.toBe('POST');
  expect(
    screen.queryByRole('button', { name: /approve|booking|OTP/i })
  ).toBeNull();
});
it('checks payment status for the exact reference and never requests approval', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled()
  );
  expect(
    screen.queryByRole('button', { name: 'Check payment status' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
  await screen.findByTitle('Oxygen secure payment');
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    workflowId: workflow,
    reference,
    version: 3,
    action: 'check_status',
  });
});
it('keeps status recovery available but blocks another uncertain link resend', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        ...state,
        paymentUrl: null,
        resendBlocked: true,
        lastOutcome: 'indeterminate',
      })
    )
  );
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  await screen.findByText(/waiting for Oxygen to confirm your last request/i);
  expect(
    screen.queryByRole('button', { name: 'Get a new payment link' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Check payment status' })
  ).toBeNull();
});
it('does not display a link returned for another selected reference', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ ...state, reference: workflow }))
  );
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  await screen.findByRole('alert');
  expect(screen.queryByRole('link')).toBeNull();
});
it('can refresh a still-running recovery request without creating another provider action', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...state, pending: true }))
    .mockResolvedValue(Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  await screen.findByText(/Oxygen is processing your last request/i);
  expect(
    screen.queryByRole('link', { name: 'Continue to payment' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled()
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(
    true
  );
});

it('recovers a missing link behind Continue using status then one exact-reference link request', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...state, paymentUrl: null }))
    .mockResolvedValueOnce(Response.json({ ...state, paymentUrl: null }))
    .mockResolvedValueOnce(Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(button);
  expect(await screen.findByTitle('Oxygen secure payment')).toHaveAttribute(
    'src',
    state.paymentUrl
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    fetcher.mock.calls.slice(1).map((call) => JSON.parse(call[1].body))
  ).toMatchObject([
    { action: 'check_status', reference, workflowId: workflow, version: 3 },
    { action: 'resend_upfront', reference, workflowId: workflow, version: 3 },
  ]);
});
it('does not repeat an indeterminate resend when Continue cannot find a link', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ ...state, paymentUrl: null, resendBlocked: true })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(
    fetcher.mock.calls
      .filter((call) => call[1]?.method === 'POST')
      .map((call) => JSON.parse(call[1].body).action)
  ).toEqual(['check_status']);
});

it('waits for confirmation on return without offering repeat payment or generating another link', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByTitle('Oxygen secure payment');
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await waitFor(() =>
    expect(screen.queryByTitle('Oxygen secure payment')).toBeNull()
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(
    screen.getByRole('heading', { name: 'Confirming your payment…' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reopens the previous plan and code view while preserving the payment reference and avoiding approval', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
      previousStep={
        <section aria-label="Previous plan and verification step">
          Saved breakdown and code
        </section>
      }
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'View plan and verification' })
  );
  expect(
    screen.getByRole('region', { name: 'Previous plan and verification step' })
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
  expect(await screen.findByTitle('Oxygen secure payment')).toHaveAttribute(
    'src',
    state.paymentUrl
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('shows confirmed payment only after the automatic return check succeeds', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(state))
    .mockResolvedValueOnce(
      Response.json({ ...state, paymentComplete: true, paymentUrl: null })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByTitle('Oxygen secure payment');
  expect(screen.queryByText('Upfront payment confirmed')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  expect(
    await screen.findByText('Upfront payment confirmed')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Payment confirmed' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    action: 'check_status',
    reference,
  });
});
it('does not mark payment successful or repeat a mutation when the return check fails', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(state))
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByTitle('Oxygen secure payment');
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('Upfront payment confirmed')).toBeNull();
  expect(
    fetcher.mock.calls
      .filter((call) => call[1]?.method === 'POST')
      .map((call) => JSON.parse(call[1].body).action)
  ).toEqual(['check_status']);
});

it.each([
  { paymentComplete: true, setupComplete: false },
  { paymentComplete: false, setupComplete: true },
  { paymentComplete: null, setupComplete: null },
])('does not show success for incomplete or unknown confirmation %j', async (flags) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ ...state, ...flags }));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: flags.paymentComplete
          ? 'Set up repayments'
          : 'Continue to payment',
      })
    ).toBeEnabled()
  );
  expect(
    screen.queryByRole('heading', { name: 'Payment confirmed' })
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  'confirmed',
  'delayed',
  'failure',
])('automatically refreshes the returned payment screen (%s)', async (mode) => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(button);
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to payment plan' })
    );
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  if (mode === 'confirmed')
    fetcher.mockResolvedValue(
      Response.json({ ...state, paymentComplete: true, setupComplete: true })
    );
  if (mode === 'failure') fetcher.mockRejectedValue(new Error('network'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(65000);
  });
  if (mode === 'confirmed')
    expect(
      screen.getByRole('heading', { name: 'Payment confirmed' })
    ).toBeInTheDocument();
  else
    expect(
      screen.getByRole('heading', { name: 'Waiting for payment confirmation' })
    ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', {
      name: /Check payment status|Continue to payment|approve/i,
    })
  ).toBeNull();
  const actions = fetcher.mock.calls
    .filter((call) => call[1]?.method === 'POST')
    .map((call) => JSON.parse(call[1].body).action);
  expect(actions.every((action) => action === 'check_status')).toBe(true);
});

it('offers only repayment setup when the return confirms payment but setup is incomplete', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(state))
    .mockImplementation(async () =>
      Response.json({
        ...state,
        paymentComplete: true,
        setupComplete: false,
        setupUrl:
          'https://payment.hydrogenpay.com/?transactionId=setup-synthetic',
      })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
    />
  );
  const button = screen.getByRole('button', { name: 'Continue to payment' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByTitle('Oxygen secure payment');
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  expect(
    await screen.findByRole('button', { name: 'Set up repayments' })
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  expect(
    screen.queryByRole('heading', { name: 'Payment confirmed' })
  ).toBeNull();
});
