import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartIcon } from './cart-icon';

describe('CartIcon', () => {
  it('caps the cart badge at 99+ and hides it at zero', () => {
    const { container, rerender } = render(<CartIcon count={0} />);

    expect(container.textContent).not.toMatch(/99\+|\d/);

    rerender(<CartIcon count={3} />);
    expect(container.textContent).toContain('3');

    rerender(<CartIcon count={120} />);
    expect(container.textContent).toContain('99+');
  });
});
