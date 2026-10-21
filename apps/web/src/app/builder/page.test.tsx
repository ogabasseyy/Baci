import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BuilderPage from './page';

const mockBuilderClient = vi.fn(() => <div data-testid="builder-client" />);

vi.mock('@/components/csrf-initializer', () => ({
  CsrfInitializer: () => <div data-testid="csrf-initializer" />,
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="merchant-provider">{children}</div>
  ),
}));

vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="storefront-provider">{children}</div>
  ),
}));

vi.mock('@/components/builder/copilot-builder-wrapper', () => ({
  CopilotBuilderWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="copilot-builder-wrapper">{children}</div>
  ),
}));

vi.mock('./builder-client', () => ({
  default: () => mockBuilderClient(),
}));

describe('BuilderPage', () => {
  beforeEach(() => {
    mockBuilderClient.mockReset();
    mockBuilderClient.mockImplementation(() => (
      <div data-testid="builder-client" />
    ));
  });

  it('mounts CsrfInitializer for builder mutations', () => {
    render(<BuilderPage />);

    expect(screen.getByTestId('csrf-initializer')).toBeInTheDocument();
    expect(screen.getByTestId('builder-client')).toBeInTheDocument();
  });

  it('renders a local fallback while the builder client is pending', () => {
    mockBuilderClient.mockImplementation(() => {
      throw new Promise(() => {
        // Intentionally never resolves to keep the local fallback visible.
      });
    });

    render(<BuilderPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading builder');
  });
});
