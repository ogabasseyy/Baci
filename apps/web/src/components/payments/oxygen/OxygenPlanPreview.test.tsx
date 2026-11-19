import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenPlanPreview } from './OxygenPlanPreview';

it('shows the chosen down payment without inventing a monthly quotation', () => {
  const view = render(
    <OxygenPlanPreview productAmount={400000} percentage={25} tenure={3} />
  );
  expect(screen.getByText('Not quoted yet')).toBeVisible();
  expect(screen.getByText(/₦100,000/)).toBeVisible();
  view.rerender(
    <OxygenPlanPreview productAmount={400000} percentage={null} tenure={3} />
  );
  expect(screen.getByText(/between 25% and 90%/)).toBeVisible();
});
