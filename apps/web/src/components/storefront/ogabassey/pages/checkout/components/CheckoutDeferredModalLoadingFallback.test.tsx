import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutDeferredModalLoadingFallback } from './CheckoutDeferredModalLoadingFallback';

describe('bugfix: block checkout while a deferred dialog chunk loads', () => {
  it('renders a modal-shaped blocking fallback instead of an inline status', () => {
    render(<CheckoutDeferredModalLoadingFallback />);

    const dialog = screen.getByRole('dialog', {
      name: 'Loading checkout dialog',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(screen.getByRole('status')).toHaveTextContent('Loading dialog…');
  });
});
