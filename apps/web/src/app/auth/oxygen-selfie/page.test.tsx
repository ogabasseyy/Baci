import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/components/payments/oxygen/OxygenPhoneContinuation', () => ({
  OxygenPhoneContinuation: ({ selfieOrigins }: { selfieOrigins: string[] }) => (
    <p data-origins={selfieOrigins.join(',')}>Continue verification</p>
  ),
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: () => ({
    selfie: ['https://selfie.example.test'],
    hosted: [],
  }),
}));

import Page, { metadata } from './page';

it('renders the phone continuation and disallows indexing and referrer disclosure', () => {
  render(<Page />);
  expect(screen.getByText('Continue verification')).toHaveAttribute(
    'data-origins',
    'https://selfie.example.test'
  );
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.referrer).toBe('no-referrer');
});
