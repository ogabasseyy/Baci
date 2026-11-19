import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./use-oxygen-confirmation-updates', () => ({
  useOxygenConfirmationUpdates: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';
import { rememberPhoneOtpSend } from './phone-otp-window';

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

it.each([
  false,
  true,
])('requires explicit resend after queued retirement, lost response: %s', async (lost) => {
  const id = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  rememberPhoneOtpSend(id, Date.now() - 300_001);
  const snapshot = {
    workflowId: id,
    stage: 'eligibility_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: id },
    pending: {
      action: 'validate_customer',
      status: 'queued',
      idempotencyKey: key,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let retired = false;
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/phone-recovery')) {
      calls.push({ url, body: JSON.parse(String(options?.body)) });
      retired = true;
      if (lost) throw new Error('lost response');
      return Response.json({ retired: true });
    }
    if (url.endsWith('/actions') && options?.method === 'POST') {
      calls.push({ url, body: JSON.parse(String(options.body)) });
      return Response.json({ ...snapshot, version: 4, pending: null });
    }
    return Response.json(
      url.includes('?')
        ? { ...snapshot, pending: retired ? null : snapshot.pending }
        : { workflow: { id } }
    );
  });
  render(<OxygenProviderFlow orderId={id} />);
  const resend = await screen.findByRole('button', { name: 'Resend code' });
  fireEvent.click(resend);
  fireEvent.click(resend);
  if (lost) {
    await screen.findByText(
      'We couldn’t send a new code right now. Please wait a moment and try again.'
    );
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  }
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[0].body).toEqual({
    workflowId: id,
    version: 3,
    idempotencyKey: key,
  });
  expect(calls[1].body.command).toEqual({ action: 'resend_customer_otp' });
  expect(calls[1].body.idempotencyKey).not.toBe(key);
});

it.each([
  'executing',
  'indeterminate',
] as const)('only reads status for an %s verification', async (status) => {
  const id = '60000000-0000-4000-8000-000000000003';
  rememberPhoneOtpSend(id, Date.now() - 300_001);
  const snapshot = {
    workflowId: id,
    stage: 'eligibility_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: id },
    pending: { action: 'validate_customer', status, idempotencyKey: id },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string) =>
    Response.json(url.includes('?') ? snapshot : { workflow: { id } })
  );
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/actions?'))
        .length
    ).toBeGreaterThan(1)
  );
  expect(
    fetcher.mock.calls.some(
      ([url, options]) =>
        options?.method === 'POST' &&
        (String(url).endsWith('/actions') ||
          String(url).endsWith('/phone-recovery'))
    )
  ).toBe(false);
});
