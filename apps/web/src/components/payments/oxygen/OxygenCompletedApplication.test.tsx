import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenCompletedApplication } from './OxygenCompletedApplication';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';

it('announces the active plan and notifies the confirmation surface', () => {
  const done = vi.fn();
  render(
    <OxygenOrderConfirmationContext.Provider value={done}>
      <OxygenCompletedApplication />
    </OxygenOrderConfirmationContext.Provider>
  );
  expect(
    screen.getByRole('heading', { name: 'Payment plan confirmed' })
  ).toBeVisible();
  expect(screen.getByText(/plan is active/i)).toBeVisible();
  expect(done).toHaveBeenCalledOnce();
  expect(screen.queryByText(/settled/i)).toBeNull();
});
