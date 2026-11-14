import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanReview } from './OxygenPlanReview';

it('requires explicit acceptance and disables continuation for a changed plan', () => {
  const accept = vi.fn();
  const replace = vi.fn();
  render(
    <OxygenPlanReview
      percentage={25}
      busy={false}
      onReplace={replace}
      onAccept={accept}
    />
  );
  const next = screen.getByRole('button', { name: 'Continue to payment' });
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(next);
  expect(accept).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('combobox', { name: 'Down payment' }), {
    target: { value: '30' },
  });
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Update plan' }));
  expect(replace).toHaveBeenCalledWith(30);
});
