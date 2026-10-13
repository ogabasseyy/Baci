import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SantaChatHeader } from './santa-chat-header';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('SantaChatHeader', () => {
  it('links to the resolved merchant cart and exposes the close action', () => {
    const onClose = vi.fn();

    render(
      <SantaChatHeader
        onClose={onClose}
        merchantSlug="winter-store"
        cartCount={2}
      />
    );

    expect(
      screen.getByRole('link', { name: 'View Cart (2 items)' })
    ).toHaveAttribute('href', '/winter-store/cart');
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
