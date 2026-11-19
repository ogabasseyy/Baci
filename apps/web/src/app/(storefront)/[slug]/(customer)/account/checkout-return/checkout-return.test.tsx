import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CheckoutReturn } from './checkout-return';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  session: { isLoading: true, isAuthenticated: false },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => mocks.session,
}));

beforeEach(() => {
  mocks.replace.mockClear();
  mocks.session.isLoading = true;
  mocks.session.isAuthenticated = false;
});
it('waits for account reconciliation before returning to checkout', () => {
  const view = render(
    <CheckoutReturn slug="ogabassey" next="/checkout?resume=1" />
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  mocks.session.isLoading = false;
  mocks.session.isAuthenticated = true;
  view.rerender(<CheckoutReturn slug="ogabassey" next="/checkout?resume=1" />);
  expect(mocks.replace).toHaveBeenCalledWith('/checkout?resume=1');
});
it('does not proceed when reconciliation fails', () => {
  mocks.session.isLoading = false;
  render(<CheckoutReturn slug="ogabassey" next="/checkout" />);
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('could not restore');
  expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/ogabassey/account/login'
  );
});
it('does not redirect to a different origin', () => {
  mocks.session.isLoading = false;
  mocks.session.isAuthenticated = true;
  render(
    <CheckoutReturn slug="ogabassey" next="https://attacker.example/checkout" />
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    screen.getByRole('link', { name: 'Return to checkout' })
  ).toHaveAttribute('href', '/ogabassey/checkout');
});
