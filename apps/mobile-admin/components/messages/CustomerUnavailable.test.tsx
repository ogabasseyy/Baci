import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { CustomerUnavailable } from './CustomerUnavailable';

describe('CustomerUnavailable', () => {
  it('says the customer could not be loaded and retries on tap', () => {
    const onRetry = vi.fn();
    render(<CustomerUnavailable colors={LIGHT_COLORS} onRetry={onRetry} />);

    expect(
      screen.getByText('Customer details could not be loaded.')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading customer details' })
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says the shown details may be old when only a later check failed', () => {
    render(
      <CustomerUnavailable colors={LIGHT_COLORS} onRetry={vi.fn()} stale />
    );

    expect(
      screen.getByText('These customer details may be out of date.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Customer details could not be loaded.')
    ).toBeNull();
  });
});
