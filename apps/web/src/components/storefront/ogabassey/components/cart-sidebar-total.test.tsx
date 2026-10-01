import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartSidebarTotal } from './cart-sidebar-total';

describe('CartSidebarTotal', () => {
  it('shows the total without subtotal or shipping rows', () => {
    render(<CartSidebarTotal total={198000} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('₦198,000')).toBeInTheDocument();
    expect(screen.queryByText(/subtotal|shipping|calculated at checkout/i)).not.toBeInTheDocument();
  });

  it('renders a zero total', () => {
    render(<CartSidebarTotal total={0} />);
    expect(screen.getByText('₦0')).toBeInTheDocument();
  });
});
