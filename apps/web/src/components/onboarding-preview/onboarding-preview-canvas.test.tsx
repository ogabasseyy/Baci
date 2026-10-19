import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingPreviewCanvas } from './onboarding-preview-canvas';

vi.mock('@puckeditor/core', () => ({
  Render: ({ data }: { data: unknown }) => (
    <div data-testid="preview-render">{JSON.stringify(data)}</div>
  ),
}));
vi.mock('@/components/builder/config', () => ({ builderConfig: {} }));
vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({
    children,
    initialMerchant,
  }: {
    children: React.ReactNode;
    initialMerchant: { business_name: string; id: string };
  }) => (
    <div
      data-merchant-id={initialMerchant.id}
      data-merchant-name={initialMerchant.business_name}
    >
      {children}
    </div>
  ),
}));

describe('OnboardingPreviewCanvas', () => {
  it('renders supplied data inside a stable preview merchant context', () => {
    render(
      <OnboardingPreviewCanvas
        businessName="North Star"
        businessType="fashion"
        brandColors={{
          primary: '#14532d',
          background: '#fff7ed',
          accent: '#f97316',
        }}
        data={{ content: [], root: { props: {} }, zones: {} }}
        resetKey="north-star"
      />
    );

    expect(screen.getByTestId('preview-render')).toBeInTheDocument();
    expect(screen.getByTestId('preview-render').parentElement).toHaveAttribute(
      'data-merchant-id',
      'preview-merchant-id'
    );
  });

  it('forces supplied Header blocks into preview mode for the synthetic merchant', () => {
    render(
      <OnboardingPreviewCanvas
        businessName="North Star"
        businessType="fashion"
        brandColors={{
          primary: '#14532d',
          background: '#fff7ed',
          accent: '#f97316',
        }}
        data={{
          content: [
            {
              type: 'Header',
              props: { id: 'Header-home', isPreview: false },
            },
          ],
          root: { props: {} },
          zones: {},
        }}
        resetKey="north-star"
      />
    );

    expect(screen.getByTestId('preview-render')).toHaveTextContent(
      '"isPreview":true'
    );
  });
});
