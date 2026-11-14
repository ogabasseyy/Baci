import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenRecoverySignIn } from './OxygenRecoverySignIn';

vi.mock('./OxygenSignIn', () => ({
  OxygenSignIn: ({ merchantSlug }: { merchantSlug: string }) => (
    <p>Sign in for {merchantSlug}</p>
  ),
}));

it('shows the store-scoped sign-in before any recovery data', () => {
  render(<OxygenRecoverySignIn merchantSlug="shop" />);
  expect(screen.getByText('Sign in for shop')).toBeVisible();
});
