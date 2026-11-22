import { act, renderHook } from '@testing-library/react-native';
import { type OxygenOtpProps, useOxygenOtp } from './use-oxygen-otp';

describe('native Oxygen OTP', () => {
  const sentAt = '2026-11-04T10:00:00Z';
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(sentAt));
  });
  afterEach(() => jest.useRealTimers());
  it('sanitizes paste, submits once, and keeps pending digits', () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const { result, rerender } = renderHook(
      ({ value, pending }: { value: string; pending: boolean }) =>
        useOxygenOtp({
          scopeKey: 'phone',
          value,
          onChange,
          onComplete,
          pending,
          confirmed: false,
          sentAt,
        }),
      { initialProps: { value: '', pending: false } }
    );
    act(() => result.current.change('12 34-56'));
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(() => result.current.change('123456'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    rerender({ value: '123456', pending: true });
    expect(result.current.value).toBe('123456');
    expect(result.current.success).toBe(false);
  });
  it('never restarts expiry on rerender and fails closed without a window', () => {
    const props = {
      scopeKey: 'approval',
      value: '',
      onChange: jest.fn(),
      onComplete: jest.fn(),
      pending: false,
      confirmed: false,
      sentAt,
    };
    const { result, rerender } = renderHook(
      (p: OxygenOtpProps) => useOxygenOtp(p),
      {
        initialProps: props,
      }
    );
    act(() => jest.advanceTimersByTime(300000));
    rerender({ ...props });
    expect(result.current.remaining).toBe(0);
    act(() => result.current.change('123456'));
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it('keeps resend failures distinct without resetting server timing', async () => {
    const { result } = renderHook(() =>
      useOxygenOtp({
        scopeKey: 'phone',
        value: '',
        onChange: jest.fn(),
        onComplete: jest.fn(),
        pending: false,
        confirmed: false,
        sentAt,
        onResend: () => Promise.reject(new Error('private')),
      })
    );
    act(() => jest.advanceTimersByTime(300000));
    await act(async () => result.current.resend());
    expect(result.current.resendError).toBe(
      'Could not send another code. Try again.'
    );
    expect(result.current.remaining).toBe(0);
  });
});
