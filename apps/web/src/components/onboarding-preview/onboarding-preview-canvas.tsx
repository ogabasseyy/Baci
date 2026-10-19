'use client';

import type { Data } from '@puckeditor/core';
import { Render } from '@puckeditor/core';
import { Component, type ReactNode } from 'react';
import { builderConfig } from '@/components/builder/config';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';
import { CartProvider } from '@/hooks/use-cart';
import type { MerchantData } from '@/hooks/use-merchant';
import type { BrandColors } from '@/types';

interface Props {
  businessName: string;
  businessType: string;
  brandColors: BrandColors;
  data: Data;
  resetKey: string;
}

function markHeaderBlocksAsPreview(data: Data): Data {
  return {
    ...data,
    content: data.content.map((block) =>
      block.type === 'Header'
        ? { ...block, props: { ...block.props, isPreview: true } }
        : block
    ),
  };
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    const isContextError = [
      'useMerchant must be used within a MerchantProvider',
      'useCart must be used within a CartProvider',
    ].some((message) => error.message.includes(message));
    if (!isContextError) throw error;
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey)
      this.setState({ hasError: false });
  }

  render() {
    return this.state.hasError ? (
      <div className="p-6 rounded-lg border border-dashed flex items-center justify-center h-full text-muted-foreground">
        Preview temporarily unavailable. Your store will display correctly after
        onboarding.
      </div>
    ) : (
      this.props.children
    );
  }
}

export function OnboardingPreviewCanvas({
  businessName,
  businessType,
  brandColors,
  data,
  resetKey,
}: Props) {
  const previewData = markHeaderBlocksAsPreview(data);
  return (
    <PreviewErrorBoundary resetKey={resetKey}>
      <MerchantProvider
        initialMerchant={
          {
            id: 'preview-merchant-id',
            user_id: 'preview-user-id',
            business_name: businessName || 'Your Store',
            business_type: businessType || 'other',
            slug: 'preview-store',
            brand_colors: brandColors,
          } as MerchantData
        }
      >
        <CartProvider merchantSlug="preview-store" deferValidationUntilIdle>
          <Render config={builderConfig} data={previewData} />
        </CartProvider>
      </MerchantProvider>
    </PreviewErrorBoundary>
  );
}
