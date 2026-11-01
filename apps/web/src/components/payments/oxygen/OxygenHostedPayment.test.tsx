import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OxygenHostedPayment } from './OxygenHostedPayment';

let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function paint() {
  const callbacks = frames.splice(0);
  act(() => {
    for (const callback of callbacks) callback(0);
  });
}
function mountPaymentFrame() {
  paint();
  paint();
}

const url = 'https://payment.hydrogenpay.com/?transactionId=synthetic';
it('covers the entire payment viewport and keeps the iframe hidden until document load', () => {
  render(<OxygenHostedPayment url={url} onClose={vi.fn()} />);
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(screen.getByRole('status')).toHaveStyle({ backgroundColor: '#fff' });
  paint();
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  paint();
  const frame = screen.getByTitle('Oxygen secure payment');
  expect(frame).toHaveClass('invisible');
  expect(frame).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('status')).toHaveClass('inset-0', 'bg-white');
  expect(screen.queryByText('Loading secure payment…')).toBeNull();
  fireEvent.load(frame);
  expect(frame).not.toHaveClass('invisible');
  expect(frame).toHaveAttribute('aria-hidden', 'false');
  expect(screen.queryByRole('status')).toBeNull();
});
it('keeps Back available while loading without treating a load as payment confirmation', () => {
  const back = vi.fn();
  render(<OxygenHostedPayment url={url} onClose={back} />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  expect(back).toHaveBeenCalledTimes(1);
  mountPaymentFrame();
  fireEvent.load(screen.getByTitle('Oxygen secure payment'));
  expect(screen.queryByText(/paid|payment confirmed/i)).toBeNull();
});
it('restores the full cover for a different payment URL', () => {
  const { rerender } = render(
    <OxygenHostedPayment url={url} onClose={vi.fn()} />
  );
  mountPaymentFrame();
  fireEvent.load(screen.getByTitle('Oxygen secure payment'));
  rerender(<OxygenHostedPayment url={`${url}-other`} onClose={vi.fn()} />);
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(screen.getByRole('status')).toBeInTheDocument();
  mountPaymentFrame();
  expect(screen.getByTitle('Oxygen secure payment')).toHaveStyle({
    visibility: 'hidden',
  });
});
