import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

const m = vi.hoisted(() => ({
  fetch: vi.fn(),
  submit: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./OxygenProviderFlow', () => ({
  OxygenProviderFlow: ({ active }: { active: boolean }) => {
    const snapshot: OxygenRuntimeSnapshot = {
      workflowId: '60000000-0000-4000-8000-000000000001',
      stage: 'reconciliation_required',
      version: 4,
      environment: 'staging',
      executionEnabled: true,
      state: {
        validated: true,
        selfieUrl:
          'https://staging.d1l1k5yxed9cvn.amplifyapp.com/?token=fixture',
      },
      approvalOtpReady: false,
      checkoutPhone: '',
      checkoutAddress: {},
      activationEnabled: false,
      settlementEnabled: false,
      pending: {
        action: 'validate_nin',
        status: 'indeterminate',
        idempotencyKey: '60000000-0000-4000-8000-000000000002',
      },
    };
    useOxygenSelfieHandoff(snapshot, active, false, m.submit, m.refresh);
    return <p>Existing application, NIN paused</p>;
  },
}));

import { OxygenApplicationDialog } from './OxygenApplicationDialog';
import { useOxygenSelfieHandoff } from './use-oxygen-selfie-handoff';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
  vi.useRealTimers();
});
it('automatically opens the existing selfie and returns to the same application only on provider confirmation', async () => {
  m.fetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-10-25T21:00:00Z' })
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ confirmed: true, checkedAt: '2026-10-25T21:01:00Z' })
      )
    );
  render(<OxygenApplicationDialog orderId="same-order" />);
  const dialog = screen.getByRole('dialog');
  const frame = screen.getByTitle('Oxygen selfie verification');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.load(frame);
  expect(screen.getByTitle('Oxygen selfie verification')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByTitle('Oxygen selfie verification')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByText('Existing application, NIN paused')).toBeVisible();
  expect(m.refresh).toHaveBeenCalledOnce();
  expect(m.submit).not.toHaveBeenCalled();
});
