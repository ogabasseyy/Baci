import { render, screen } from '@testing-library/react';
import { isValidElement, Suspense } from 'react';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  connection: vi.fn(async () => {}),
  readOrigins: vi.fn(() => ({
    hosted: ['https://selfie.example.test'],
    selfie: ['https://selfie.example.test'],
  })),
}));
vi.mock('next/server', () => ({ connection: m.connection }));
vi.mock('@/components/payments/oxygen/OxygenPhoneContinuation', () => ({
  OxygenPhoneContinuation: ({ selfieOrigins }: { selfieOrigins: string[] }) => (
    <p data-origins={selfieOrigins.join(',')}>Continue verification</p>
  ),
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: m.readOrigins,
}));

import Page, { metadata } from './page';
import { SelfieContinuation } from './SelfieContinuation';

// Regression: awaiting connection() at the top of the page, outside any
// Suspense boundary, made `next build` fail to prerender this route, which
// broke every production deploy.
it('keeps request-time work inside a Suspense boundary', () => {
  m.connection.mockClear();
  const page = Page();
  expect(page).not.toBeInstanceOf(Promise);
  expect(isValidElement(page) && page.type).toBe(Suspense);
  expect(m.connection).not.toHaveBeenCalled();
});

it('reads the selfie origin configuration at request time', async () => {
  m.connection.mockClear();
  m.readOrigins.mockReturnValueOnce({
    hosted: ['https://first.example.test'],
    selfie: ['https://first.example.test'],
  });
  const first = await SelfieContinuation();
  const second = await SelfieContinuation();
  expect(m.connection).toHaveBeenCalledTimes(2);
  expect(first.props.selfieOrigins).toEqual(['https://first.example.test']);
  expect(second.props.selfieOrigins).toEqual(['https://selfie.example.test']);
});

it('renders the phone continuation and disallows indexing and referrer disclosure', async () => {
  render(await SelfieContinuation());
  expect(screen.getByText('Continue verification')).toHaveAttribute(
    'data-origins',
    'https://selfie.example.test'
  );
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.referrer).toBe('no-referrer');
});
