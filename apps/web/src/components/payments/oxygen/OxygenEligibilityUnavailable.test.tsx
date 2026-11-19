import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenEligibilityUnavailable } from './OxygenEligibilityUnavailable';

it('explains that no installment plan is available and progress is saved', () => {
  render(<OxygenEligibilityUnavailable />);
  expect(
    screen.getByRole('heading', {
      name: 'No installment plan is available right now',
    })
  ).toBeDefined();
  expect(screen.getByText(/Your application is saved/)).toBeDefined();
});
