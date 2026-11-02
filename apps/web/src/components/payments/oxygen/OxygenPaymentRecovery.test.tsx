import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OxygenHostedOriginsContext } from './OxygenPaymentSurfaceContext';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) =>
    fetch(...(args as Parameters<typeof fetch>)),
}));

import { OxygenPaymentRecovery } from './OxygenPaymentRecovery';

function render(element: ReactElement) {
  return rtlRender(
    <OxygenHostedOriginsContext.Provider
      value={['https://payment.hydrogenpay.com']}
    >
      {element}
    </OxygenHostedOriginsContext.Provider>
  );
}

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
    screen.getByRole('button', { name: 'Check payment status' })
  ).toBeEnabled();
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
it('checks a still-running recovery without resending a payment link', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...state, pending: true }))
    .mockResolvedValue(Response.json({ ...state, pending: true }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check payment status' })
    ).toBeEnabled()
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    screen.getByText(/Oxygen is processing your last request/i)
  ).toBeVisible();
  expect(fetcher.mock.calls[0][1]?.method).not.toBe('POST');
  expect(fetcher.mock.calls[1][1]?.method).toBe('POST');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    action: 'check_status',
    reference,
    workflowId: workflow,
    version: 3,
  });
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
  const button = await screen.findByRole('button', {
    name: 'Check payment status',
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(
    fetcher.mock.calls
      .filter((call) => call[1]?.method === 'POST')
      .map((call) => JSON.parse(call[1].body).action)
  ).toEqual(['check_status']);
});
