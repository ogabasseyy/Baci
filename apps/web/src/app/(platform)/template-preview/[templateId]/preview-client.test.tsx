import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplatePreviewClient } from './preview-client';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="cart-provider">{children}</div>
  ),
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="merchant-provider">{children}</div>
  ),
}));

describe('TemplatePreviewClient', () => {
  it('renders an error card when the requested template is not in the registry', () => {
    render(<TemplatePreviewClient templateId="non-existent-template-xyz" />);

    expect(screen.getByText('Template Error')).toBeDefined();
    expect(
      screen.getByText('Template "non-existent-template-xyz" not found.')
    ).toBeDefined();
  });
});
