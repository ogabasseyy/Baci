import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuantityButton } from './quantity-button';

describe('QuantityButton', () => {
  it('labels quantity buttons and respects disabled', () => {
    const onClick = vi.fn();
    render(
      <>
        <QuantityButton type="plus" onClick={onClick} />
        <QuantityButton type="minus" onClick={onClick} disabled />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Decrease quantity' })
    ).toBeDisabled();
  });
});
