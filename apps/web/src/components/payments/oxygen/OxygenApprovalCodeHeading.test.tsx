import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it } from 'vitest';
import { OxygenApprovalCodeHeading } from './OxygenApprovalCodeHeading';

it('binds the focus target to the approval code heading and identifies delivery channel', () => {
  const ref = createRef<HTMLHeadingElement>();
  render(<OxygenApprovalCodeHeading headingRef={ref} />);
  expect(ref.current).toBe(
    screen.getByRole('heading', { name: 'Enter your approval code' })
  );
  expect(ref.current).toHaveAttribute('tabindex', '-1');
  expect(screen.getByText(/sent to your email/i)).toBeVisible();
});
