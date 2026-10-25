import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { OtpVerificationField } from './OtpVerificationField';

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
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
it('expires after exactly five minutes and blocks code completion', () => {
  const sentAt = Date.now();
  const complete = vi.fn();
  render(
    <OtpVerificationField
      value="12345"
      onChange={vi.fn()}
      onComplete={complete}
      sentAt={sentAt}
    />
  );
  expect(screen.getByRole('timer')).toHaveTextContent('5:00');
  act(() => vi.advanceTimersByTime(299000));
  expect(screen.getByRole('timer')).toHaveTextContent('0:01');
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole('status')).toHaveTextContent('This code has expired');
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.queryByText('1')).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});
it('preserves the original deadline after reopening and catches up after a background clock jump', () => {
  const sentAt = Date.now();
  const change = vi.fn();
  const complete = vi.fn();
  const props = { value: '', onChange: change, onComplete: complete, sentAt };
  const first = render(<OtpVerificationField {...props} />);
  act(() => vi.advanceTimersByTime(60000));
  first.unmount();
  render(<OtpVerificationField {...props} />);
  expect(screen.getByRole('timer')).toHaveTextContent('4:00');
  // A suspended tab's handlers must check the absolute deadline before the next tick.
  vi.setSystemTime(sentAt + 300001);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  expect(change).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole('textbox')).toBeDisabled();
});
it('resends only on a click, blocks duplicate clicks, and waits for a new confirmed send time', async () => {
  let finish!: (value: boolean) => void;
  const resend = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  const sentAt = Date.now() - 300000;
  const props = { value: '', onChange: vi.fn(), sentAt, onResend: resend };
  const view = render(<OtpVerificationField {...props} />);
  expect(resend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sending…' }));
  expect(resend).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(screen.getByRole('textbox')).toBeDisabled();
  view.rerender(<OtpVerificationField {...props} sentAt={Date.now()} />);
  expect(screen.getByRole('timer')).toHaveTextContent('5:00');
  expect(screen.getByRole('textbox')).toBeEnabled();
});
it('keeps expiry and safe messaging when resend fails', async () => {
  const resend = vi.fn().mockRejectedValue(new Error('private provider token'));
  render(
    <OtpVerificationField
      value=""
      onChange={vi.fn()}
      sentAt={Date.now() - 300000}
      onResend={resend}
    />
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'private provider token'
  );
  expect(screen.getByRole('textbox')).toBeDisabled();
});
