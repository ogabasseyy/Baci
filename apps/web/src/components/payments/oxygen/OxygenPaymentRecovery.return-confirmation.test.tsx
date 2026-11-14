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
    screen.getByRole('heading', { name: 'Your saved payment plan' })
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
