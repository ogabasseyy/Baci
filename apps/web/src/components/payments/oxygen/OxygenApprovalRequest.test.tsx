import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { continueWithSignature } from './approval-test-helpers';
import { OxygenApprovalCode } from './OxygenApprovalCode';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
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
const reference = '70000000-0000-4000-8000-000000000025';
function setup(
  requestCode: (reference: string) => Promise<boolean>,
  canonical = reference
) {
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      window: {
        bookingReference: reference,
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    })
  );
  const approve = vi.fn();
  render(
    <OxygenApprovalCode
      workflowId="60000000-0000-4000-8000-000000000001"
      reference={reference}
      state={{
        bookingReference: canonical,
        schedule: [
          {
            period: 1,
            dueDate: [2026, 11, 27],
            amount: 100,
            principal: 90,
            interest: 10,
          },
        ],
      }}
      requestCode={requestCode}
      approvePlan={approve}
      busy={false}
    />
  );
  return approve;
}
it('Continue requests one fresh code for the selected reference and waits for confirmation before opening OTP', async () => {
  let finish: (sent: boolean) => void = () => {};
  const request = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  const approve = setup(request);
  expect(request).not.toHaveBeenCalled();
  continueWithSignature();
  expect(request).toHaveBeenCalledExactlyOnceWith(reference);
  expect(
    screen.queryByRole('textbox', { name: 'Verification code' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Sending code…' })).toBeDisabled();
  expect(screen.getByText('Sending code…')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Sending code…' }).querySelector('svg')
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sending code…' }));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  await screen.findByRole('textbox', { name: 'Verification code' });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  expect(approve).not.toHaveBeenCalled();
});
it('retains signature and acceptance after an unconfirmed send without auto retrying or opening OTP', async () => {
  const request = vi.fn().mockRejectedValue(new Error('connection lost'));
  const approve = setup(request);
  continueWithSignature();
  await screen.findByRole('alert');
  expect(screen.getByText('Signature ready')).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(
    screen.queryByRole('textbox', { name: 'Verification code' })
  ).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(approve).not.toHaveBeenCalled();
});
it('does not request an OTP for a reference different from the canonical selected plan', () => {
  const request = vi.fn().mockResolvedValue(true);
  setup(request, '70000000-0000-4000-8000-000000000035');
  continueWithSignature();
  expect(request).not.toHaveBeenCalled();
});
