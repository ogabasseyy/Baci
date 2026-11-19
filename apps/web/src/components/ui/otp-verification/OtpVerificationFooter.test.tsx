import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OtpVerificationFooter } from './OtpVerificationFooter';

it('offers resend only after expiry and forwards the action', () => {
  const resend = vi.fn(async () => {});
  const props = {
    sentAt: 1,
    onResend: vi.fn(async () => true),
    resendAfterExpiry: true,
    expiry: { ready: true, expiresAt: 2, expired: false, remainingSeconds: 60 },
    expiryAdvisory: false,
    verified: false,
    disabled: false,
    pending: false,
    resending: false,
    coolingDown: false,
    cooldown: { remainingSeconds: 0, canResend: () => true },
    resend,
  };
  const view = render(<OtpVerificationFooter {...props} />);
  expect(screen.getByRole('timer', { name: 'Code expiry' })).toHaveTextContent(
    '1:00'
  );
  expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
  view.rerender(
    <OtpVerificationFooter
      {...props}
      expiry={{ ...props.expiry, expired: true, remainingSeconds: 0 }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(resend).toHaveBeenCalledOnce();
  view.rerender(
    <OtpVerificationFooter
      {...props}
      pending
      expiry={{ ...props.expiry, expired: true, remainingSeconds: 0 }}
    />
  );
  expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled();
});
