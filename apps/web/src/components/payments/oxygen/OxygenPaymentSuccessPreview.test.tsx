import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenPaymentSuccessPreview } from './OxygenPaymentSuccessPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('labels the fixed mock and shows payment awaiting confirmation without requests', () => {
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
  expect(screen.getByText('Awaiting order confirmation')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Back to checkout' })).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
