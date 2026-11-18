import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { OxygenOtp } from './OxygenOtp';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
describe('native OTP presentation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const base = {
    scopeKey: 'phone',
    value: '123456',
    onChange: jest.fn(),
    onComplete: jest.fn(),
    pending: true,
    confirmed: false,
    sentAt: '2026-11-04T10:00:00Z',
  };
  it('keeps digits while pending and ticks only after server confirmation', async () => {
    const view = render(<OxygenOtp {...base} />);
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.queryByLabelText('Code confirmed')).toBeNull();
    view.rerender(<OxygenOtp {...base} pending={false} confirmed />);
    await act(async () => {});
    expect(screen.getByLabelText('Code confirmed')).toBeTruthy();
  });
  it('handles paste and backspace using the accessible native input', () => {
    const change = jest.fn();
    const complete = jest.fn();
    render(
      <OxygenOtp
        {...base}
        value=""
        pending={false}
        onChange={change}
        onComplete={complete}
      />
    );
    const input = screen.getByLabelText('Six-digit verification code');
    fireEvent.changeText(input, '12 34-56');
    expect(change).toHaveBeenLastCalledWith('123456');
    expect(complete).toHaveBeenCalledTimes(1);
    fireEvent.changeText(input, '12345');
    expect(change).toHaveBeenLastCalledWith('12345');
  });
  it('keeps the countdown and restores input with a clear failure without a success tick', () => {
    const view = render(<OxygenOtp {...base} />);
    expect(screen.getByText('Resend in 5:00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
    view.rerender(
      <OxygenOtp
        {...base}
        pending={false}
        error="We could not confirm this code."
      />
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      screen.getByLabelText('Six-digit verification code').props.editable
    ).toBe(true);
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.queryByLabelText('Code confirmed')).toBeNull();
  });
  it('explains that an expired code must be resent before typing', () => {
    render(
      <OxygenOtp
        {...base}
        pending={false}
        label="Enter your approval code"
        onResend={jest.fn()}
      />
    );
    act(() => jest.advanceTimersByTime(300_000));
    expect(
      screen.getByText('Your code has expired. Tap Resend code to continue.')
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Six-digit verification code').props.editable
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeTruthy();
  });
  it('settles confirmation even when animation never completes', async () => {
    jest
      .mocked(AccessibilityInfo.isReduceMotionEnabled)
      .mockResolvedValue(false);
    render(<OxygenOtp {...base} pending={false} confirmed />);
    await act(async () => {});
    await act(async () => jest.advanceTimersByTime(450));
    expect(screen.getByLabelText('Code confirmed')).toBeTruthy();
  });
});
