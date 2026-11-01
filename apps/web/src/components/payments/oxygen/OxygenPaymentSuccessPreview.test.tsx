import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenPaymentSuccessPreview } from './OxygenPaymentSuccessPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('labels the fixed mock, makes no requests, and only closes the preview on its CTA', () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  render(<OxygenPaymentSuccessPreview />);
  expect(screen.getByText(/MOCKED PREVIEW/)).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Payment confirmed' })
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to checkout' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
