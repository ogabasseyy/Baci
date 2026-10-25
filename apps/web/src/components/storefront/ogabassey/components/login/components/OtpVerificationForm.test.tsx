import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OtpVerificationForm } from './OtpVerificationForm';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const props = () => ({
  continueHref: '/ogabassey/imei-check',
  code: '',
  onCodeChange: vi.fn(),
  onComplete: vi.fn().mockResolvedValue(undefined),
  onResend: vi.fn().mockResolvedValue(true),
  onChangeEmail: vi.fn(),
  error: '',
  isVerifying: false,
  isSending: false,
  verified: false,
  sentAt: Date.now(),
});

it('uses the existing ten-minute login window and waits for explicit resend after expiry', () => {
  const handlers = props();
  render(<OtpVerificationForm {...handlers} />);
  expect(
    screen.getByRole('textbox', { name: 'Email verification code' })
  ).toHaveAttribute('autocomplete', 'one-time-code');
  expect(screen.getByRole('timer')).toHaveTextContent('10:00');
  act(() => {
    vi.advanceTimersByTime(600000);
  });
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('expired');
  expect(handlers.onResend).not.toHaveBeenCalled();
});

it('keeps verification pending until the caller confirms success and blocks email switching', () => {
  const handlers = props();
  const view = render(
    <OtpVerificationForm {...handlers} code="123456" isVerifying />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Checking your code');
  expect(
    screen.getByRole('button', { name: 'Use a different email' })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Use a different email' })
  );
  expect(handlers.onChangeEmail).not.toHaveBeenCalled();
  view.rerender(<OtpVerificationForm {...handlers} verified />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Signed in successfully'
  );
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
    'href',
    '/ogabassey/imei-check'
  );
  expect(
    screen.queryByRole('button', { name: 'Resend code' })
  ).not.toBeInTheDocument();
});
