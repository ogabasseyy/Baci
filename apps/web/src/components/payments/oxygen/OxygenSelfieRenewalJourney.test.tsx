import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

const m = vi.hoisted(() => ({ fetch: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./OxygenProviderFlow', () => ({
  OxygenProviderFlow: ({ active }: { active: boolean }) => {
    const [snapshot, setSnapshot] = useState<OxygenRuntimeSnapshot>({
      workflowId: '60000000-0000-4000-8000-000000000001',
      stage: 'kyc_required',
      version: 4,
      environment: 'staging',
      executionEnabled: true,
      approvalOtpReady: false,
      activationEnabled: false,
      settlementEnabled: false,
      checkoutPhone: '',
      checkoutAddress: {},
      state: {
        validated: true,
        selfieUrl: `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp: 1 }))}.c`,
      },
    });
    useOxygenSelfieHandoff(
      snapshot,
      active,
      false,
      async (command) => {
        m.submit(command);
        if (command.action === 'selfie_link')
          setSnapshot((s) => ({
            ...s,
            version: 5,
            state: {
              ...s.state,
              selfieUrl: `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.c`,
            },
          }));
        return true;
      },
      async () => {}
    );
    return <p>Saved application</p>;
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
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('renews an expired session inside the existing dialog, then returns only on provider confirmation', async () => {
  m.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
      )
  );
  render(
    <OxygenApplicationDialog
      orderId="same-order"
      selfieOrigins={['https://selfie.example']}
    />
  );
  const dialog = screen.getByRole('dialog');
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(0));
  const frame = screen.getByTitle('Oxygen selfie verification');
  fireEvent.load(frame);
  expect(frame).toBeVisible();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(m.submit).toHaveBeenCalledExactlyOnceWith({ action: 'selfie_link' });
  m.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ confirmed: true, checkedAt: '2026-11-05T16:01:00Z' })
      )
  );
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(m.submit).toHaveBeenLastCalledWith({ action: 'refresh_kyc' });
});
