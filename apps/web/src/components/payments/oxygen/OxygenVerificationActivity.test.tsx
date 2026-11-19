import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenVerificationActivity } from './OxygenVerificationActivity';

it('keeps its decorative activity out of the accessibility tree', () => {
  const { container } = render(<OxygenVerificationActivity />);
  expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(container).not.toHaveTextContent(/approved|%/i);
});
