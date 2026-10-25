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
  api.fetch.mockImplementation(fixture.fetch);
  vi.useFakeTimers();
  render(<OxygenProviderFlow orderId={fixtureId} />);
  await waitForUI(() =>
    expect(screen.getByLabelText('Verification code')).toBeVisible()
  );
}

it('guides OTP to selfie and leaves NIN paused after selfie confirmation', async () => {
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
  expect(fixture.actions).toEqual([
    'validate_customer',
    'refresh_kyc',
    'selfie_link',
  ]);
  expect(
    screen.queryByRole('button', {
      name: /Check eligibility|Verify NIN|Check verification status/,
    })
  ).toBeNull();
  fixture.finishSelfie();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(screen.getByText('Selfie verified')).toBeVisible()
  );
  expect(fixture.actions).not.toContain('validate_nin');
  expect(fixture.actions).not.toContain('refresh_eligibility');
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
  expect(fixture.snapshot().activationEnabled).toBe(false);
  expect(fixture.snapshot().settlementEnabled).toBe(false);
});

it('keeps an expired or incorrect OTP recoverable without repeating it automatically', async () => {
  const fixture = createProviderJourney();
  await open(fixture);
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '000000' },
  });
  await waitForUI(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('That code isn’t valid')
  );
  expect(fixture.actions).toEqual(['validate_customer']);
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitForUI(() =>
    expect(
      screen.getByText('A new code has been sent. Check your phone.')
    ).toBeVisible()
  );
  expect(fixture.actions).toEqual(['validate_customer', 'resend_customer_otp']);
});

it('reconciles a timeout without sending the original command again', async () => {
  const fixture = createProviderJourney();
  await open(fixture);
  fixture.timeout();
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  await waitForUI(() =>
    expect(fixture.snapshot().stage).toBe('reconciliation_required')
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(fixture.actions).toEqual(['validate_customer']);
  expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
});

it('stops after a completed unavailable offer instead of checking forever', async () => {
  const fixture = createProviderJourney();
  fixture.setEligibility('ineligible');
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
      screen.getByText('No installment plan is available right now')
    ).toBeVisible()
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(
    fixture.actions.filter((action) => action === 'refresh_eligibility')
  ).toHaveLength(1);
  expect(
    screen.queryByRole('form', { name: 'Choose payment plan' })
  ).toBeNull();
});

it('bounds pending eligibility checks and saves the application for a later return', async () => {
  const fixture = createProviderJourney();
  fixture.setEligibility('pending');
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
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
  }
  await waitForUI(() =>
    expect(screen.getByText('This is taking a little longer')).toBeVisible()
  );
  expect(
    fixture.actions.filter((action) => action === 'refresh_eligibility')
  ).toHaveLength(3);
  expect(
    screen.queryByRole('form', { name: 'Choose payment plan' })
  ).toBeNull();
});

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
    expect(screen.getByRole('form', { name: 'Verify address' })).toBeVisible()
  );
  await waitForUI(() =>
    expect(screen.getByText('Repayment schedule')).toBeVisible()
  );
  expect(
    screen.queryByRole('button', { name: 'Load repayment schedule' })
  ).toBeNull();
  await waitForUI(() =>
    expect(
      screen.getByRole('button', { name: 'Submit address for verification' })
    ).toBeEnabled()
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
    expect(screen.getByText('Your address is under review')).toBeVisible()
  );
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
  fixture.finishAddress();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  await waitForUI(() =>
    expect(screen.queryByText('Your address is under review')).toBeNull()
  );
  expect(screen.getByRole('region', { name: 'Loan breakdown' })).toBeVisible();
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

it('explains a rate limit without claiming the OTP failed or resending it', async () => {
  const fixture = createProviderJourney();
  await open(fixture);
  fixture.rateLimitNext();
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitForUI(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please wait a moment before trying again.'
    )
  );
  expect(fixture.actions).toEqual([]);
  expect(fixture.operations).toEqual([]);
  expect(
    screen.queryByText('A new code has been sent. Check your phone.')
  ).toBeNull();
});
