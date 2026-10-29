import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatLauncherFixture } from './ChatLauncherFixture';

vi.mock('@/components/storefront/ogabassey/components/PopupSystem', () => ({
  PopupSystem: () => null,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/chat-launcher' }));
vi.mock('@/hooks/cart', () => ({ useCart: () => ({ isCartOpen: false }) }));

describe('ChatLauncherFixture', () => {
  it('mounts the production deferred chat launcher', () => {
    const { container } = render(<ChatLauncherFixture />);

    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    ).toBeVisible();
    expect(container.querySelector('.ogabassey-chat-anchor')).toBeVisible();
  });
});
