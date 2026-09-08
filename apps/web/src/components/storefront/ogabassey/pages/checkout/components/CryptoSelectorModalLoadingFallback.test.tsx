import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CryptoSelectorModalLoadingFallback } from './CryptoSelectorModalLoadingFallback';

describe('bugfix: block checkout while the crypto dialog chunk loads', () => {
  it('renders a modal-shaped blocking fallback instead of an inline status', () => {
    render(<CryptoSelectorModalLoadingFallback />);

    const dialog = screen.getByRole('dialog', {
      name: 'Loading crypto payment selector',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(screen.getByRole('status')).toHaveTextContent('Loading dialog…');
  });
});
