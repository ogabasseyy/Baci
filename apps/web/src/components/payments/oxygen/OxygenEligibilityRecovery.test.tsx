import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it('recovers an eligibility timeout with one explicit eligibility-only retry, preserving completed identity checks', async () => {
  const id = '60000000-0000-4000-8000-000000000071';
  const actions: string[] = [];
  const snapshot = {
    workflowId: id,
    stage: 'kyc_required',
    version: 10,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: id,
      validated: true,
      kyc: {
        phone_status: 'DONE',
        bvn_status: 'DONE',
        selfie_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        address_status: 'NOT_DONE',
      },
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST') {
      actions.push(JSON.parse(String(opts.body)).command.action);
      if (actions.length === 1)
        return Response.json(
          { error: 'Action failed; please check the details and try again' },
          { status: 409 }
        );
      return new Promise<Response>(() => {});
    }
    return Response.json(
      url.includes('?')
        ? {
            ...snapshot,
            version: actions.length ? 11 : 10,
            state: {
              ...snapshot.state,
              ...(actions.length ? { eligibilityStatus: 'failed' } : {}),
            },
          }
        : { workflow: { id } }
    );
  });
  const view = render(<OxygenProviderFlow orderId={id} />);
  expect(
    await screen.findByRole('heading', {
      name: 'We couldn’t finish checking your payment options',
    })
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Your details and verification are saved.'
  );
  const retry = screen.getByRole('button', { name: 'Try again' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(actions).toEqual(['refresh_eligibility', 'refresh_eligibility'])
  );
  expect(
    screen.getByRole('heading', { name: 'Checking your payment options' })
  ).toBeVisible();
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  view.unmount();
});
