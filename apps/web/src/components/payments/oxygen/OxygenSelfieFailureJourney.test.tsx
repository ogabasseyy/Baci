import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./use-oxygen-confirmation-updates', () => ({
  useOxygenConfirmationUpdates: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it.each([
  true,
  false,
])('only offers selfie retry when the failed command is confirmed (%s)', async (confirmed) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const snapshot = {
    workflowId,
    stage: 'kyc_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      validated: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'NOT_DONE',
      },
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  let attempts = 0;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) {
      if (attempts && !confirmed) return Response.json({}, { status: 503 });
      return Response.json({ ...snapshot, version: attempts ? 2 : 1 });
    }
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      attempts++;
      return Response.json({}, { status: 503 });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  await screen.findByRole('alert');
  expect(attempts).toBe(1);
  if (confirmed) {
    fireEvent.click(
      screen.getByRole('button', { name: 'Try selfie verification again' })
    );
    await waitFor(() => expect(attempts).toBe(2));
  } else {
    expect(
      screen.queryByRole('button', { name: 'Try selfie verification again' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Check for an update' })
    ).toBeVisible();
  }
});
