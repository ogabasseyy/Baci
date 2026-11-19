import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenStepHeading } from './OxygenStepHeading';

it.each([
  ['identity', 'Verify your identity', 'lucide-shield-check'],
  ['bank', 'Verify your bank account', 'lucide-landmark'],
  ['income', 'Employment and consent', 'lucide-briefcase-business'],
] as const)('shows the appropriate decorative icon for %s', (step, title, icon) => {
  render(<OxygenStepHeading step={step} />);
  const heading = screen.getByRole('heading', { name: title });
  expect(heading.parentElement?.querySelector(`svg.${icon}`)).toHaveAttribute(
    'aria-hidden',
    'true'
  );
});
