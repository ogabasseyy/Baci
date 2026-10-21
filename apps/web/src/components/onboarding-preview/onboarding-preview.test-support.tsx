import { render } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

const mockPuckRenderState = vi.hoisted(() => ({
  errorMessage: null as string | null,
}));

vi.mock(
  '@/lib/storefront-defaults/derive-curated-theme',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/storefront-defaults/derive-curated-theme')
      >();
    return {
      ...actual,
      deriveCuratedTheme: vi.fn(actual.deriveCuratedTheme),
    };
  }
);
vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: unknown }) => {
    if (mockPuckRenderState.errorMessage)
      throw new Error(mockPuckRenderState.errorMessage);
    return <div data-testid="puck-render">{JSON.stringify(data)}</div>;
  },
}));
vi.mock('@/components/builder/config', () => ({ builderConfig: {} }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
    children: React.ReactNode;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({
    children,
    initialMerchant,
  }: {
    children: React.ReactNode;
    initialMerchant?: { id?: string };
  }) => (
    <div data-testid="merchant-provider" data-merchant-id={initialMerchant?.id}>
      {children}
    </div>
  ),
}));
vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({
    children,
    merchantSlug,
  }: {
    children: React.ReactNode;
    merchantSlug?: string | null;
  }) => <div data-testid={`cart-provider:${merchantSlug}`}>{children}</div>,
}));

import { OnboardingPuckPreview } from '../onboarding-puck-preview';

export const previewProps = {
  businessName: 'Test Store',
  businessType: 'fashion',
  logoDataUri: 'data:image/png;base64,test',
  brandColors: { primary: '#000000', background: '#FFFFFF', accent: '#FF0000' },
};
export const renderPreview = (
  props: Partial<React.ComponentProps<typeof OnboardingPuckPreview>> = {}
) => render(<OnboardingPuckPreview {...previewProps} {...props} />);
export const setPuckRenderError = (errorMessage: string | null) => {
  mockPuckRenderState.errorMessage = errorMessage;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPuckRenderState.errorMessage = null;
});
