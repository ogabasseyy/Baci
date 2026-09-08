import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImeiCheckFallback } from './imei-check-fallback';

describe('ImeiCheckFallback', () => {
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
