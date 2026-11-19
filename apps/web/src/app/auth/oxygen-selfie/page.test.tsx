import { isValidElement, Suspense } from 'react';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock('next/server', () => ({ connection: m.connection }));
vi.mock('@/components/payments/oxygen/OxygenPhoneContinuation', () => ({
  OxygenPhoneContinuation: () => null,
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: () => ({ hosted: [], selfie: [] }),
}));

import Page, { metadata } from './page';
import { SelfieContinuation } from './SelfieContinuation';

// Regression: awaiting connection() at the top of the page, outside any
// Suspense boundary, made `next build` fail to prerender this route, which
// broke every production deploy.
it('keeps request-time work inside a Suspense boundary', () => {
  const page = Page();
  expect(page).not.toBeInstanceOf(Promise);
  expect(isValidElement(page) && page.type).toBe(Suspense);
  const child =
    isValidElement<{ children: unknown }>(page) && page.props.children;
  expect(isValidElement(child) && child.type).toBe(SelfieContinuation);
  expect(m.connection).not.toHaveBeenCalled();
});

it('disallows indexing and referrer disclosure', () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(metadata.referrer).toBe('no-referrer');
});
