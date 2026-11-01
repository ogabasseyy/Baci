import {
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
it('opens the saved exact-reference payment once after confirmed approval without issuing a new link', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={3}
      autoOpen
    />
  );
  expect(await screen.findByTitle('Oxygen secure payment')).toHaveAttribute(
    'src',
    state.paymentUrl
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(
    <OxygenPaymentRecovery
      workflowId={workflow}
      reference={reference}
      version={4}
      autoOpen
    />
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(
    fetcher.mock.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => JSON.parse(options.body).action)
  ).toEqual(['check_status']);
});
