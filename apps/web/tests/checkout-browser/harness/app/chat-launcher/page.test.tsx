import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ChatLauncherPage from './page';

vi.mock('@/components/storefront/ogabassey/components/PopupSystem', () => ({
  PopupSystem: () => null,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/chat-launcher' }));
vi.mock('@/hooks/cart', () => ({ useCart: () => ({ isCartOpen: false }) }));

it('mounts the chat launcher harness fixture', () => {
  render(<ChatLauncherPage />);

  expect(
    screen.getByRole('button', { name: 'Open AI chat assistant' })
  ).toBeVisible();
  expect(document.querySelector('.ogabassey-chat-anchor')).toBeVisible();
});
