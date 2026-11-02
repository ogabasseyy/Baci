import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

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

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
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

async function open(fixture: ReturnType<typeof createProviderJourney>) {
  api.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/payments/oxygen/plans/accept')
      return Promise.resolve(Response.json({ accepted: true }));
    if (url.includes('/residential-context?'))
      return Promise.resolve(Response.json({ address: {} }));
    return fixture.fetch(url, init);
  });
  vi.useFakeTimers();
  render(<OxygenProviderFlow orderId={fixtureId} />);
  await waitForUI(() =>
    expect(screen.getByLabelText('Verification code')).toBeVisible()
  );
}

it('books the chosen plan, loads its schedule, and resumes after address review without another upload', async () => {
  const fixture = createProviderJourney();
  await open(fixture);
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  await waitForUI(() =>
    expect(
      screen.getByRole('link', { name: 'Continue to selfie verification' })
    ).toBeVisible()
  );
  fixture.finishSelfie();
  fixture.finishNin(); // Provider fixture precondition for downstream eligibility coverage.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(
      screen.getByRole('form', { name: 'Choose payment plan' })
    ).toBeVisible()
  );
  fireEvent.click(screen.getByRole('button', { name: '35%' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  await waitForUI(() =>
    expect(
      screen.getByRole('button', { name: 'Accept payment plan' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept payment plan' }));
  await waitForUI(() =>
    expect(screen.getByRole('form', { name: 'Verify address' })).toBeVisible()
  );
  expect(screen.queryByText('Preparing your repayment schedule…')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  for (const [label, value] of [
    ['State', 'Lagos'],
    ['City / town', 'Ikeja'],
    ['Local government area (LGA)', 'Ikeja'],
    ['Street address', 'Example Road'],
    ['Nearby landmark', 'Example Mall'],
    ['House / flat number', '4'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(
    screen.getByLabelText(
      'This is my home address and matches my proof of address.'
    )
  );
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: {
      files: [new File(['proof'], 'proof.png', { type: 'image/png' })],
    },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Verify address' }));
  });
  expect(fixture.actions).toContain('submit_address');
  await waitForUI(() =>
    expect(screen.getByText('Oxygen is reviewing your address')).toBeVisible()
  );
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Upload another proof' })
  ).toBeNull();
  expect(
    fixture.actions.filter((action) => action === 'submit_address')
  ).toHaveLength(1);
  fixture.finishAddress();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(screen.queryByText('Oxygen is reviewing your address')).toBeNull()
  );
  expect(
    screen.getByRole('heading', { name: 'Sign and accept your payment plan' })
  ).toBeVisible();
  // Approval requests now belong to the exact-reference saved-plan control.
  expect(
    screen.queryByRole('button', { name: 'Send approval OTP' })
  ).toBeNull();
  expect(
    fixture.actions.filter((action) => action === 'submit_address')
  ).toHaveLength(1);
  expect(fixture.operations).not.toContain('approve');
  expect(fixture.operations).not.toContain('activate');
  expect(fixture.operations).not.toContain('settle');
});
