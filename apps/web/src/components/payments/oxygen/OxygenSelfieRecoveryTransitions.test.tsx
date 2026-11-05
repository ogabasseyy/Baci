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

const m = vi.hoisted(() => ({
  fetch: vi.fn(),
  submit: vi.fn(),
  delayed: false,
  fail: false,
  finish: (() => {}) as () => void,
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./OxygenPhoneHandoff', () => ({
  OxygenPhoneHandoff: ({ onBack }: { onBack: () => void }) => (
    <div>
      <p>Phone QR handoff</p>
      <button type="button" onClick={onBack}>
        Use this laptop instead
      </button>
    </div>
  ),
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
        selfieUrl: link(1),
        kyc: {
          phone_status: 'DONE',
          bvn_status: 'DONE',
          selfie_status: 'NOT_DONE',
          nin_status: 'NOT_DONE',
          bank_status: 'NOT_DONE',
          address_status: 'NOT_DONE',
        },
      },
    });
    const submit = async (command: { action: string }) => {
      m.submit(command);
      if (command.action === 'selfie_link') {
        if (m.fail) return false;
        const replace = () =>
          setSnapshot((s) => ({
            ...s,
            version: s.version + 1,
            state: {
              ...s.state,
              selfieUrl: link(Math.floor(Date.now() / 1000) + 300),
            },
          }));
        if (m.delayed)
          await new Promise<void>((resolve) => {
            m.finish = () => {
              replace();
              resolve();
            };
          });
        else replace();
      }
      return true;
    };
    useOxygenSelfieHandoff(snapshot, active, false, submit, async () => {});
    return (
      <>
        <p>Saved application</p>
        <OxygenGuidedVerification
          snapshot={snapshot}
          busy={false}
          error=""
          enabled={active}
          submit={submit}
        />
      </>
    );
  },
}));

import { OxygenApplicationDialog } from './OxygenApplicationDialog';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';
import { useOxygenSelfieHandoff } from './use-oxygen-selfie-handoff';

function link(exp: number) {
  return `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp }))}.c`;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.delayed = false;
  m.fail = false;
  m.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ confirmed: false, checkedAt: '2026-11-05T16:00:00Z' })
      )
  );
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
it('keeps a refreshed link during phone handoff and adopts it on return without another request', async () => {
  m.delayed = true;
  render(
    <OxygenApplicationDialog
      orderId="same-order"
      selfieOrigins={['https://selfie.example']}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(m.submit).toHaveBeenCalledExactlyOnceWith({ action: 'selfie_link' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue on your phone' })
  );
  const phone = screen.getByText('Phone QR handoff');
  await act(async () => {
    m.finish();
  });
  expect(screen.getByText('Phone QR handoff')).toBe(phone);
  fireEvent.click(
    screen.getByRole('button', { name: 'Use this laptop instead' })
  );
  expect(screen.getByTitle('Oxygen selfie verification')).toHaveAttribute(
    'src',
    link(Math.floor(Date.now() / 1000) + 300)
  );
  expect(m.submit).toHaveBeenCalledTimes(1);
});
it('can resume expired verification after leaving a failed camera session', async () => {
  m.fail = true;
  render(
    <OxygenApplicationDialog
      orderId="same-order"
      selfieOrigins={['https://selfie.example']}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole('alert')).toBeVisible();
  m.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(m.submit).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to selfie verification' })
  );
  await act(() => vi.advanceTimersByTimeAsync(1));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByTitle('Oxygen selfie verification')).toBeInTheDocument();
  expect(
    m.submit.mock.calls.filter(([c]) => c.action === 'selfie_link')
  ).toHaveLength(2);
});
it.each([
  'Back',
  'Escape',
])('holds a late replacement after %s until the customer continues', async (exit) => {
  m.delayed = true;
  render(
    <OxygenApplicationDialog
      orderId="same-order"
      selfieOrigins={['https://selfie.example']}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  if (exit === 'Escape')
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { bubbles: false, cancelable: true })
    );
  else
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to application' })
    );
  await act(async () => {
    m.finish();
  });
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(m.submit).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to selfie verification' })
  );
  expect(screen.getByTitle('Oxygen selfie verification')).toBeInTheDocument();
});
