import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
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
import styles from './OtpVerificationField.module.css';

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
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
});
it('supports four-digit codes and explicit verification without a completion handler', () => {
  const onChange = vi.fn();
  const view = render(
    <OtpVerificationField
      value=""
      onChange={onChange}
      length={4}
      label="Email code"
      name="email_code"
      id="email-code"
    />
  );
  const input = screen.getByRole('textbox', { name: 'Email code' });
  expect(input).toHaveAttribute('maxlength', '4');
  expect(input).toHaveAttribute('name', 'email_code');
  expect(view.container.querySelectorAll('[data-filled]')).toHaveLength(4);
  fireEvent.change(input, { target: { value: '1234' } });
  expect(onChange).toHaveBeenCalledWith('1234');
  expect(view.container.querySelector('[data-state="verified"]')).toBeNull();
});
it('announces checking and confirmed success, prevents editing, and restores entry after rejection', () => {
  const props = { value: '123456', onChange: vi.fn(), onComplete: vi.fn() };
  const view = render(
    <OtpVerificationField
      {...props}
      pending
      pendingMessage="Checking email code"
    />
  );
  expect(
    screen.getByRole('status', { name: 'Verification code status' })
  ).toHaveTextContent('Checking email code');
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.queryByText('1')).toBeNull();
  view.rerender(<OtpVerificationField {...props} error="Code expired" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Code expired');
  expect(screen.getByRole('textbox')).toHaveAttribute(
    'aria-describedby',
    screen.getByRole('alert').id
  );
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox')).toBeEnabled();
  view.rerender(
    <OtpVerificationField
      {...props}
      verified
      successMessage="Email confirmed"
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Email confirmed');
  expect(screen.getByRole('textbox')).toBeDisabled();
});
it('normalizes a pasted code and calls completion once for a controlled value transition', () => {
  const onChange = vi.fn();
  const onComplete = vi.fn();
  const view = render(
    <OtpVerificationField
      value=""
      onChange={onChange}
      onComplete={onComplete}
    />
  );
  fireEvent.paste(screen.getByRole('textbox'), {
    clipboardData: { getData: () => '123 456' },
  });
  expect(onChange).toHaveBeenCalledWith('123456');
  view.rerender(
    <OtpVerificationField
      value="123456"
      onChange={onChange}
      onComplete={onComplete}
    />
  );
  expect(onComplete).toHaveBeenCalledExactlyOnceWith('123456');
  view.rerender(
    <OtpVerificationField
      value="123456"
      onChange={onChange}
      onComplete={onComplete}
      pending
    />
  );
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it('never treats a pending animation as confirmed success', () => {
  const complete = vi.fn();
  const props = {
    value: '123456',
    onChange: vi.fn(),
    onStackComplete: complete,
  };
  const view = render(<OtpVerificationField {...props} pending />);
  function animationEnd() {
    const slot = view.container.querySelectorAll('[data-filled]')[5];
    for (const name of ['animationend', 'webkitAnimationEnd']) {
      const event = new Event(name, { bubbles: true });
      Object.defineProperty(event, 'animationName', { value: styles.stack });
      fireEvent(slot, event);
    }
  }
  animationEnd();
  expect(complete).not.toHaveBeenCalled();
  expect(view.container.querySelector('[data-state="verified"]')).toBeNull();
  view.rerender(<OtpVerificationField {...props} verified />);
  animationEnd();
  expect(complete).toHaveBeenCalled();
});

it('returns keyboard focus to the real input after a rejected verification', () => {
  const onChange = vi.fn();
  const field = (pending: boolean, error?: string) => (
    <div>
      <OtpVerificationField
        value={error ? '' : '123456'}
        onChange={onChange}
        pending={pending}
        error={error}
      />
      <button type="button">Other action</button>
    </div>
  );
  const view = render(field(false));
  const input = screen.getByRole('textbox');
  act(() => input.focus());
  expect(input).toHaveFocus();
  view.rerender(field(true));
  // JSDOM does not reproduce browser blur when an active input is disabled.
  act(() => screen.getByRole('button', { name: 'Other action' }).focus());
  expect(input).not.toHaveFocus();
  view.rerender(field(false, 'Incorrect code'));
  expect(input).toBeEnabled();
  expect(input).toHaveFocus();
});

it('does not move focus back to the input after confirmed success', () => {
  const props = { value: '123456', onChange: vi.fn() };
  const view = render(<OtpVerificationField {...props} pending />);
  view.rerender(<OtpVerificationField {...props} verified />);
  expect(screen.getByRole('textbox')).not.toHaveFocus();
});
