import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ChatLauncherPage from './page';

vi.mock('@/components/storefront/ogabassey/components/PopupSystem', () => ({
  PopupSystem: () => null,
}));

it('mounts the chat launcher harness fixture', () => {
  render(<ChatLauncherPage />);

  expect(
    screen.getByRole('button', { name: 'Assistant launcher' })
  ).toBeVisible();
  expect(screen.getByTestId('deferred-launcher')).toBeVisible();
});
