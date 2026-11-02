import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/payments/oxygen/OxygenPhoneContinuation', () => ({
  OxygenPhoneContinuation: () => <p>Continue verification</p>,
}));

import Page, { metadata } from './page';

it('renders the phone continuation and disallows indexing and referrer disclosure', () => {
  render(<Page />);
  expect(screen.getByText('Continue verification')).toBeInTheDocument();
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.referrer).toBe('no-referrer');
});
