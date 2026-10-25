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

afterEach(() => vi.useRealTimers());
async function waitForUI(assertion: () => void) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      /* Flush the next React update. */
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  assertion();
}
it('requires explicit offer acceptance, guides payment before setup, and stops with activation disabled', async () => {
  const fixture = createProviderJourney();
  fixture.resumeApproval();
  api.fetch.mockImplementation(fixture.fetch);
  vi.useFakeTimers();
  render(<OxygenProviderFlow orderId={fixtureId} />);
  await waitForUI(() =>
    expect(
      screen.getByRole('button', { name: 'Send approval OTP' })
    ).toBeEnabled()
  );
  expect(fixture.operations).not.toContain('approve');
  fireEvent.click(screen.getByRole('button', { name: 'Send approval OTP' }));
  await waitForUI(() =>
    expect(
      screen.getByRole('form', { name: 'Accept loan offer' })
    ).toBeVisible()
  );
  fireEvent.change(screen.getByLabelText('Approval OTP'), {
    target: { value: '654321' },
  });
  fireEvent.change(screen.getByLabelText('Signature image'), {
    target: {
      files: [new File(['signature'], 'signature.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByLabelText('I accept the displayed loan offer'));
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Accept loan offer' }));
  });
  await waitForUI(() =>
    expect(
      screen.getByRole('link', { name: 'Pay upfront amount' })
    ).toBeVisible()
  );
  expect(screen.queryByRole('link', { name: 'Set up repayments' })).toBeNull();
  fixture.finishPayment();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(
      screen.getByRole('link', { name: 'Set up repayments' })
    ).toBeVisible()
  );
  expect(screen.queryByRole('link', { name: 'Pay upfront amount' })).toBeNull();
  fixture.finishSetup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(
      screen.getByText('Upfront steps complete. Activation is not enabled.')
    ).toBeVisible()
  );
  expect(fixture.operations).not.toContain('activate');
  expect(fixture.operations).not.toContain('settle');
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
  expect(JSON.stringify(fixture.snapshot())).not.toContain('654321');
  expect(JSON.stringify(fixture.snapshot())).not.toContain(
    'synthetic-activity-token'
  );
});
