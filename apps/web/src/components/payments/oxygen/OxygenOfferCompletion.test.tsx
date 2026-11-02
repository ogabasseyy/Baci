import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import {
  createProviderJourney,
  fixtureId,
} from './__fixtures__/provider-journey';
import { OxygenProviderFlow } from './OxygenProviderFlow';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function waitForUI(assertion: () => void) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      /* Flush provider and animation updates. */
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  assertion();
}
it('requires plan and signature acceptance before approval and keeps payment confirmation distinct from activation', async () => {
  const fixture = createProviderJourney();
  fixture.resumeApproval();
  let paymentComplete = false;
  let setupComplete = false;
  const recoveryActions: string[] = [];
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/payments/oxygen/plans/accept')
      return Response.json({ accepted: true });
    if (url.includes('/approval-code?'))
      return Response.json({
        window: {
          bookingReference: '70000000-0000-4000-8000-000000000001',
          sentAt: new Date(Date.now()).toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      });
    if (url.includes('/recovery')) {
      if (init?.method === 'POST')
        recoveryActions.push(JSON.parse(String(init.body)).action);
      return Response.json({
        reference: '70000000-0000-4000-8000-000000000001',
        paymentComplete,
        setupComplete,
        paymentUrl: 'https://hosted.test/payment',
        setupUrl: 'https://hosted.test/setup',
        checkedAt: new Date(Date.now()).toISOString(),
        lastOutcome: 'succeeded',
        pending: false,
        resendBlocked: false,
      });
    }
    return fixture.fetch(url, init);
  });
  render(<OxygenProviderFlow orderId={fixtureId} />);
  await waitForUI(() =>
    expect(
      screen.getByRole('button', { name: 'Accept payment plan' })
    ).toBeEnabled()
  );
  expect(fixture.operations).not.toContain('approve');
  fireEvent.click(screen.getByRole('button', { name: 'Accept payment plan' }));
  await waitForUI(() =>
    expect(
      screen.getByRole('heading', { name: 'Sign and accept your payment plan' })
    ).toBeVisible()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: {
      files: [new File(['signature'], 'signature.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept this payment plan/ })
  );
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  await waitForUI(() =>
    expect(
      screen.getByRole('textbox', { name: 'Verification code' })
    ).toBeEnabled()
  );
  expect(fixture.operations).not.toContain('approve');
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  await waitForUI(() =>
    expect(
      fixture.operations.filter((operation) => operation === 'approve')
    ).toHaveLength(1)
  );
  await waitForUI(() =>
    expect(screen.getByTitle('Oxygen secure payment')).toHaveAttribute(
      'src',
      'https://hosted.test/payment'
    )
  );
  paymentComplete = true;
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await waitForUI(() =>
    expect(
      screen.getByRole('button', { name: 'Set up repayments' })
    ).toBeEnabled()
  );
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set up repayments' }));
  await waitForUI(() =>
    expect(screen.getByTitle('Oxygen secure payment')).toHaveAttribute(
      'src',
      'https://hosted.test/setup'
    )
  );
  setupComplete = true;
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  await waitForUI(() =>
    expect(
      screen.getByRole('heading', { name: 'Payment confirmed' })
    ).toBeVisible()
  );
  expect(recoveryActions.length).toBeGreaterThanOrEqual(2);
  expect(recoveryActions.every((action) => action === 'check_status')).toBe(
    true
  );
  expect(fixture.operations).not.toContain('activate');
  expect(fixture.operations).not.toContain('settle');
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
  expect(JSON.stringify(fixture.snapshot())).not.toContain('123456');
  expect(JSON.stringify(fixture.snapshot())).not.toContain(
    'synthetic-activity-token'
  );
});
