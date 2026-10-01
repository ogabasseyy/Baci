import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Merchant360Error from './error';

describe('Merchant360Error', () => {
  it('explains that the failed view did not mutate merchant data and retries on request', () => {
    const reset = vi.fn();

    render(<Merchant360Error reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Merchant operations could not load'
    );
    expect(
      screen.getByText('Try again. No merchant data was changed.')
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
