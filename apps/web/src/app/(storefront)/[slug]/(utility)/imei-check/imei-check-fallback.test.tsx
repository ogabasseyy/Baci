import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImeiCheckFallback } from './imei-check-fallback';

describe('ImeiCheckFallback', () => {
  it('reserves the same mobile and desktop hero padding as the final checker', () => {
    render(<ImeiCheckFallback />);

    const shell = screen.getByRole('status', { name: 'Loading IMEI checker' });
    expect(shell).toHaveClass('pt-4', 'md:pt-8');
    expect(shell.firstElementChild).toHaveClass(
      'px-4',
      'md:px-6',
      'max-w-[1400px]'
    );
  });

  it('paints the IMEI hero LCP copy in the visible page shell', () => {
    render(<ImeiCheckFallback />);

    expect(
      screen.getByRole('heading', { name: /Don't Get Scammed/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Verify First.')).toBeInTheDocument();
    expect(
      screen.getByText(/One quick check can save you from losing/)
    ).toBeInTheDocument();
  });
});
