import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { continueWithSignature } from './approval-test-helpers';
import { OxygenApprovalCode } from './OxygenApprovalCode';
import { installOxygenOtpTestEnvironment } from './oxygen-otp-test-environment.test-support';

installOxygenOtpTestEnvironment();

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mock.fetch }));
const workflow = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000025';
const state = {
  bookingReference: reference,
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 27] as [number, number, number],
      amount: 100,
      principal: 100,
      interest: 0,
    },
  ],
};
function setup(expiresAt: number) {
  mock.fetch.mockResolvedValue(
    Response.json({
      window: {
        bookingReference: reference,
        sentAt: new Date(expiresAt - 300000).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    })
  );
  const requestCode = vi.fn();
  const approvePlan = vi.fn().mockResolvedValue(false);
  render(
    <OxygenApprovalCode
      workflowId={workflow}
      reference={reference}
      state={state}
      requestCode={requestCode}
      approvePlan={approvePlan}
      busy={false}
      resumeQueuedApproval
    />
  );
  return { requestCode, approvePlan };
}
it('continues a queued approval using the saved code window without requesting another OTP', async () => {
  const { requestCode, approvePlan } = setup(Date.now() + 300000);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const file = continueWithSignature();
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(requestCode).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  await waitFor(() =>
    expect(approvePlan).toHaveBeenCalledExactlyOnceWith(
      reference,
      '123456',
      file,
      expect.any(Function)
    )
  );
  expect(requestCode).not.toHaveBeenCalled();
});
it('does not send or approve when the saved window expired', async () => {
  const { requestCode, approvePlan } = setup(Date.now() - 1000);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  continueWithSignature();
  await screen.findByRole('alert');
  expect(requestCode).not.toHaveBeenCalled();
  expect(approvePlan).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});
