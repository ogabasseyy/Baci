import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';

it('announces preparation as busy without claiming success', () => {
  render(<OxygenApplicationLoading />);
  expect(
    screen.getByRole('status', { name: 'Preparing your application' })
  ).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText(/approved|confirmed/i)).toBeNull();
});
