import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartAssuranceRow } from './cart-assurance-row';

describe('CartAssuranceRow', () => {
  it('shows coverage, cost, and removal copy when assured', () => {
    const onToggle = vi.fn();
    render(
      <CartAssuranceRow
        hasAssurance
        assuranceCost={2000}
        cartItemId="ci-1"
        onToggle={onToggle}
      />
    );

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Screen & Liquid Damage')).toBeInTheDocument();
    expect(screen.getByText('+₦2,000')).toBeInTheDocument();
    const disclosure = screen.getByText(
      'Optional. Included in total; uncheck to remove.'
    );
    expect(disclosure).toHaveClass('text-store-background-text/55');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('ci-1');
  });

  it('shows opt-in copy when unassured', () => {
    render(
      <CartAssuranceRow
        hasAssurance={false}
        assuranceCost={0}
        cartItemId="ci-1"
      />
    );

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Device Protection (+5%)')).toBeInTheDocument();
    expect(
      screen.getByText('Optional. Check to add.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\+₦/)).not.toBeInTheDocument();
  });
});
