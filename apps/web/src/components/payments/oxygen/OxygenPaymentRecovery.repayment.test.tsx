import {
  act,
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
          : flags.paymentComplete === null
            ? 'Check payment status'
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
      screen.getByRole('heading', { name: 'Your saved payment plan' })
    ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', {
      name: /Continue to payment|approve/i,
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
