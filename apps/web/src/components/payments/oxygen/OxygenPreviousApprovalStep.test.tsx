import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OxygenPreviousApprovalStep } from './OxygenPreviousApprovalStep';

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());

it('renders the prior approval code read-only without a resend action', () => {
  render(<OxygenPreviousApprovalStep state={{}} />);
  expect(
    screen.getByRole('region', { name: 'Previous plan and verification step' })
  ).toBeVisible();
  expect(
    screen.getByRole('textbox', { name: 'Verification code' })
  ).toBeDisabled();
  expect(screen.queryByRole('button', { name: /resend|approve/i })).toBeNull();
});
