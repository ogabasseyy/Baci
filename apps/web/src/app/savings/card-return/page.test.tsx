import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SavingsCardReturnPage, { metadata } from './page';

describe('savings card checkout return', () => {
  it('returns to the fixed wallet link without claiming payment completed', () => {
    render(<SavingsCardReturnPage />);

    expect(
      screen.getByRole('heading', {
        name: 'Check your contribution in the app',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Return to wallet' })
    ).toHaveAttribute('href', 'ogabassey://wallet');
    expect(screen.getByRole('main')).toHaveTextContent(
      'Returning from checkout does not confirm a payment.'
    );
    expect(screen.getByRole('main')).toHaveTextContent(
      'Do not start another payment while this one is pending.'
    );
    expect(
      screen.queryByText(
        /payment successful|payment completed|savings credited/i
      )
    ).toBeNull();
  });

  it('keeps the non-authoritative callback out of search indexes', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
