import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutResumeFallback } from './CheckoutResumeFallback';

vi.mock('./CheckoutCartCapacityGate', () => ({
  CheckoutCartCapacityGate: ({ children }: { children: React.ReactNode }) => children,
}));

it('routes a failed resume to contact support and home', () => {
  const navigate = vi.fn();
  render(<CheckoutResumeFallback cartEmpty isAutoTriggerProcessing={false} isLoadingResumedOrder={false} navigate={navigate} resumeOrderError="Unavailable" resumeOrderId="order" resumedOrderId={undefined} />);
  fireEvent.click(screen.getByRole('button', { name: /contact support/i }));
  expect(navigate).toHaveBeenCalledWith('/contact');
  fireEvent.click(screen.getByRole('button', { name: /home/i }));
  expect(navigate).toHaveBeenCalledWith('/');
});
