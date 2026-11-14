import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import styles from '@/components/ui/otp-verification/OtpVerificationField.module.css';
import { OxygenOtpAnimationPreview } from './OxygenOtpAnimationPreview';

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
afterEach(() => vi.useRealTimers());
it('ignores animation events while the simulated server response is pending', () => {
  vi.useFakeTimers();
  const view = render(<OxygenOtpAnimationPreview />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
    'Simulating'
  );
  const slots = view.container.querySelectorAll('[data-filled]');
  // A bubbling highlight event must not prematurely finish the stack.
  fireEvent.animationEnd(slots[5].querySelector('span') as HTMLElement, {
    animationName: 'orbit',
  });
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
    'Simulating'
  );
  // jsdom lacks AnimationEvent, so React can register the WebKit fallback.
  for (const name of ['animationend', 'webkitAnimationEnd']) {
    const completed = new Event(name, { bubbles: true });
    Object.defineProperty(completed, 'animationName', { value: styles.stack });
    fireEvent(slots[5], completed);
  }
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
    'Simulating'
  );
  act(() => vi.advanceTimersByTime(1300));
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
    'Simulation complete'
  );
  expect(
    view.container.querySelector('[data-state="verified"]')
  ).not.toBeNull();
});
it('starts on the sixth digit, finishes safely without animation events and resets', () => {
  vi.useFakeTimers();
  render(<OxygenOtpAnimationPreview />);
  const field = screen.getByRole('textbox', { name: 'Verification code' });
  fireEvent.change(field, { target: { value: '12345' } });
  act(() => vi.advanceTimersByTime(5000));
  expect(field).toBeEnabled();
  fireEvent.change(field, { target: { value: '123456' } });
  expect(field).toBeDisabled();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
    'No code checked or approval submitted'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Try another test code' })
  );
  expect(field).toHaveValue('');
  expect(field).toBeEnabled();
});
it('cancels the simulation fallback when closed', () => {
  vi.useFakeTimers();
  const view = render(<OxygenOtpAnimationPreview />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  act(() => vi.advanceTimersByTime(60));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
