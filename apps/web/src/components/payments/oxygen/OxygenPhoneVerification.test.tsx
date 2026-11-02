import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { OxygenPhoneVerification } from './OxygenPhoneVerification';
import { rememberPhoneOtpSend } from './phone-otp-window';

afterEach(() => vi.restoreAllMocks());

it('reopening keeps the original send window instead of restarting five minutes', () => {
  const now = Date.now();
  rememberPhoneOtpSend('phone-reopen', now - 60_000);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const submit = vi.fn();
  const first = render(
    <OxygenPhoneVerification
      workflowId="phone-reopen"
      busy={false}
      submit={submit}
    />
  );
  expect(screen.getByRole('timer')).toHaveTextContent('Code expires in 4:00');
  first.unmount();
  vi.mocked(Date.now).mockReturnValue(now + 60_000);
  render(
    <OxygenPhoneVerification
      workflowId="phone-reopen"
      busy={false}
      submit={submit}
    />
  );
  expect(screen.getByRole('timer')).toHaveTextContent('Code expires in 3:00');
  expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it('a successful resend replaces the expired window and persists it for reopening', async () => {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  rememberPhoneOtpSend('phone-expired', now - 300_000);
  const submit = vi.fn().mockResolvedValue(true);
  const first = render(
    <OxygenPhoneVerification
      workflowId="phone-expired"
      busy={false}
      submit={submit}
    />
  );
  expect(screen.queryByRole('timer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitFor(() =>
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
  );
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    action: 'resend_customer_otp',
  });
  first.unmount();
  vi.mocked(Date.now).mockReturnValue(now + 30_000);
  render(
    <OxygenPhoneVerification
      workflowId="phone-expired"
      busy={false}
      submit={submit}
    />
  );
  expect(screen.getByRole('timer')).toHaveTextContent('4:30');
  expect(submit).toHaveBeenCalledTimes(1);
});

it('an unconfirmed resend does not invent a new expiry window', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  render(
    <OxygenPhoneVerification
      workflowId="phone-unknown"
      busy={false}
      submit={submit}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
  );
  expect(screen.queryByRole('timer')).toBeNull();
  expect(submit).toHaveBeenCalledTimes(1);
});

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterAll(() => vi.unstubAllGlobals());
