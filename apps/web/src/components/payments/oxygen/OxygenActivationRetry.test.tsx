import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ provider: vi.fn(), fetch: vi.fn() }));
vi.mock('./use-oxygen-provider', () => ({ useOxygenProvider: mocks.provider }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';
import { OxygenProviderFlow } from './OxygenProviderFlow';

it('lets a paid customer retry confirmation after a transient failure and redirects only after activation', async () => {
  const workflow = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000001';
  const saved = {
    workflowId: workflow,
    version: 4,
    environment: 'staging' as const,
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state: {
      bookingReference: reference,
      paymentComplete: true,
      setupComplete: true,
    },
  };
  const confirmed = {
    reference,
    paymentComplete: true,
    setupComplete: true,
    paymentUrl: null,
    setupUrl: null,
    checkedAt: '2026-11-01T10:00:00Z',
    lastOutcome: 'succeeded',
    pending: false,
    resendBlocked: false,
  };
  let activated = false;
  let posts = 0;
  const redirect = vi.fn();
  mocks.fetch.mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      posts++;
      if (posts === 1) return Response.json({}, { status: 503 });
      activated = true;
    }
    return Response.json(confirmed);
  });
  mocks.provider.mockImplementation(() => {
    const [snapshot, setSnapshot] = useState({
      ...saved,
      stage: 'ready_for_activation',
    });
    return {
      snapshot,
      busy: false,
      error: '',
      errorAction: null,
      clearError: vi.fn(),
      submit: vi.fn(),
      refresh: vi.fn(),
      needsSignIn: false,
      readSaved: async () => {
        if (activated) setSnapshot({ ...saved, stage: 'activated' });
      },
    };
  });
  render(
    <OxygenOrderConfirmationContext.Provider value={redirect}>
      <OxygenProviderFlow orderId={workflow} />
    </OxygenOrderConfirmationContext.Provider>
  );
  fireEvent.click(
    screen.getByRole('button', { name: /check order confirmation/i })
  );
  await screen.findByRole('alert');
  expect(redirect).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: /check order confirmation/i })
  );
  await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  const requests = mocks.fetch.mock.calls.filter(
    ([, options]) => options?.method === 'POST'
  );
  expect(requests).toHaveLength(2);
  for (const [url, options] of requests) {
    expect(url).toBe('/api/payments/oxygen/recovery');
    expect(JSON.parse(options.body)).toMatchObject({
      workflowId: workflow,
      reference,
      version: 4,
      action: 'check_status',
    });
  }
});
