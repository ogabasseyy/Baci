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
});
