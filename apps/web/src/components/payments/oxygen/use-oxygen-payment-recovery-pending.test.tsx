import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('./use-oxygen-payment-watch', () => ({
  useOxygenPaymentWatch: () => false,
}));
vi.mock('./use-oxygen-payment-return', () => ({
  useOxygenPaymentReturn: () => {},
}));

import { useOxygenPaymentRecovery } from './use-oxygen-payment-recovery';

const workflow = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reference = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pending = {
  reference,
  paymentComplete: false,
  setupComplete: false,
  paymentUrl: null,
  setupUrl: null,
  checkedAt: null,
  lastOutcome: null,
  pending: true,
  resendBlocked: false,
};
const confirmed = {
  ...pending,
  paymentComplete: true,
  setupComplete: true,
  checkedAt: '2026-11-01T10:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
};
beforeEach(() => mocks.fetch.mockReset());
it('allows an explicit check to reclaim a pending read and confirm payment', async () => {
  mocks.fetch
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json(confirmed));
  const { result } = renderHook(() =>
    useOxygenPaymentRecovery(workflow, reference, 7)
  );
  await waitFor(() => expect(result.current.state?.pending).toBe(true));
  await act(async () => result.current.checkStatus());
  expect(result.current.state?.paymentComplete).toBe(true);
  const [url, options] = mocks.fetch.mock.calls[1];
  expect(url).toBe('/api/payments/oxygen/recovery');
  expect(JSON.parse(options.body)).toMatchObject({
    workflowId: workflow,
    reference,
    version: 7,
    action: 'check_status',
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it('reads cached pending state once after a conflicting active check, without a false failure', async () => {
  mocks.fetch
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json(pending));
  const { result } = renderHook(() =>
    useOxygenPaymentRecovery(workflow, reference, 7)
  );
  await waitFor(() => expect(result.current.state?.pending).toBe(true));
  await act(async () => result.current.checkStatus());
  expect(result.current.error).toBe('');
  expect(result.current.state?.pending).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  expect(mocks.fetch.mock.calls[2][0]).toContain('?workflowId=');
});
it('never resends a payment link or sends a provider status request for cached-only polling while pending', async () => {
  mocks.fetch.mockResolvedValue(Response.json(pending));
  const { result } = renderHook(() =>
    useOxygenPaymentRecovery(workflow, reference, 7)
  );
  await waitFor(() => expect(result.current.state?.pending).toBe(true));
  await act(async () => result.current.run('resend_upfront'));
  await act(async () => result.current.run('resend_repayment'));
  await act(async () => result.current.run('check_status', false, true));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(
    mocks.fetch.mock.calls.every(
      ([url]: unknown[]) =>
        typeof url === 'string' && url.includes('?workflowId=')
    )
  ).toBe(true);
});
it('rejects a fallback for another booking without a second cached read', async () => {
  mocks.fetch
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ ...pending, reference: workflow }));
  const { result } = renderHook(() =>
    useOxygenPaymentRecovery(workflow, reference, 7)
  );
  await waitFor(() => expect(result.current.state?.pending).toBe(true));
  await act(async () => result.current.checkStatus());
  expect(result.current.state?.reference).toBe(reference);
  expect(result.current.error).not.toBe('');
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});
it('accepts a completed confirmation when a competing check finishes before the conflict fallback', async () => {
  mocks.fetch
    .mockResolvedValueOnce(Response.json(pending))
    .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json(confirmed));
  const { result } = renderHook(() =>
    useOxygenPaymentRecovery(workflow, reference, 7)
  );
  await waitFor(() => expect(result.current.state?.pending).toBe(true));
  await act(async () => result.current.checkStatus());
  expect(result.current.error).toBe('');
  expect(result.current.state?.paymentComplete).toBe(true);
  expect(result.current.state?.setupComplete).toBe(true);
  expect(result.current.state?.pending).toBe(false);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});
