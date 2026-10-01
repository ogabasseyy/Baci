'use client';

import { type Config, type Data, Render } from '@puckeditor/core';
import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { builderConfig } from '@/components/builder/config';
import { StorefrontProvider } from '@/contexts/storefront-context';
import { CartContext } from '@/hooks/cart/cart-context';
import type { CartContextType } from '@/hooks/cart/cart-types';
import { MerchantContext } from '@/hooks/merchant/merchant-context';
import type { MerchantContextType, MerchantData } from '@/hooks/merchant/types';
import { getCuratedThemeTokenProjection } from '@/lib/storefront-defaults/curated-theme-token-projection';
import { defaultTheme, type ThemeConfiguration } from '@/lib/theme-config';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';
import { PreviewNavigationGuard } from './preview-navigation-guard';
import { PreviewProductGrid } from './preview-product-grid';
import { PreviewRootTitle } from './preview-root-title';

type PreviewMerchantContext = {
  basePath: string;
  id: string;
  slug: string;
};

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends object ? DeepPartial<T[Key]> : T[Key];
};

type BuilderPreviewConfig = {
  content: unknown[];
  root: unknown;
  theme?: DeepPartial<ThemeConfiguration>;
  zones?: Record<string, unknown>;
};

type RenderBuilderConfigProps = {
  config: BuilderPreviewConfig;
  merchantContext: PreviewMerchantContext;
  onRendered?: () => void;
};

const previewCart: CartContextType = {
  addToCart: () => undefined,
  cart: [],
  cartCount: 0,
  cartTotal: 0,
  clearCart: () => undefined,
  dismissUpsell: () => undefined,
  hasSmartCartPro: false,
  isCartOpen: false,
  isHydrated: true,
  lastAddedProduct: null,
  merchantSlug: 'preview-store',
  removeFromCart: () => undefined,
  setIsCartOpen: () => undefined,
  setMerchantSlug: () => undefined,
  showUpsell: false,
  subtotal: 0,
  totalItems: 0,
  updateQuantity: () => undefined,
};

function isThemeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTheme(
  fallback: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => {
      const candidate = override[key];
      if (isThemeObject(value) && isThemeObject(candidate))
        return [key, normalizeTheme(value, candidate)];
      return [key, typeof candidate === typeof value ? candidate : value];
    })
  );
}

function getPreviewTheme(config: BuilderPreviewConfig): ThemeConfiguration {
  const theme = config.theme;
  if (!isThemeObject(theme)) return defaultTheme;
  return normalizeTheme(
    defaultTheme as unknown as Record<string, unknown>,
    theme as Record<string, unknown>
  ) as unknown as ThemeConfiguration;
}

function getPreviewMerchantDisplayName(
  context: PreviewMerchantContext
): string {
  return context.slug
    .split('-')
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}

function markHeaderBlocksAsPreview(
  blocks: unknown[],
  merchantDisplayName: string
): unknown[] {
  return blocks.map((block) => {
    if (
      typeof block !== 'object' ||
      block === null ||
      !Object.hasOwn(block, 'type') ||
      !Object.hasOwn(block, 'props')
    ) {
      return block;
    }
    const candidate = block as { props: unknown; type: unknown };
    if (typeof candidate.props !== 'object' || candidate.props === null)
      return block;
    const props = candidate.props as Record<string, unknown>;
    const hasStoreName =
      typeof props.storeName === 'string' && props.storeName.trim().length > 0;
    return {
      ...block,
      props:
        candidate.type === 'Header'
          ? {
              ...props,
              isPreview: true,
              storeName: hasStoreName ? props.storeName : merchantDisplayName,
            }
          : candidate.props,
    };
  });
}

function getPreviewData(
  config: BuilderPreviewConfig,
  merchantContext: PreviewMerchantContext
): Data {
  const merchantDisplayName = getPreviewMerchantDisplayName(merchantContext);
  return {
    ...config,
    content: markHeaderBlocksAsPreview(config.content, merchantDisplayName),
    zones: config.zones
      ? Object.fromEntries(
          Object.entries(config.zones).map(([zone, blocks]) => [
            zone,
            Array.isArray(blocks)
              ? markHeaderBlocksAsPreview(blocks, merchantDisplayName)
              : blocks,
          ])
        )
      : undefined,
  } as Data;
}

function getPreviewRootTitle(root: unknown): string {
  if (!isThemeObject(root) || !isThemeObject(root.props)) return 'Home';
  return typeof root.props.title === 'string' ? root.props.title : 'Home';
}

const previewBuilderConfig = {
  ...builderConfig,
  components: {
    ...builderConfig.components,
    ...Object.fromEntries(
      Object.entries(previewInertLinkBlocks).map(([componentType, preview]) => [
        componentType,
        {
          ...builderConfig.components[
            componentType as keyof typeof builderConfig.components
          ],
          ...preview,
        },
      ])
    ),
    ProductGrid: {
      ...builderConfig.components.ProductGrid,
      render: ({
        columns,
        limit,
        showFilters,
        title,
      }: {
        columns?: number;
        limit?: number;
        showFilters?: boolean;
        title?: string;
      }) => (
        <PreviewProductGrid
          columns={columns}
          limit={limit}
          showFilters={showFilters}
          title={title}
        />
      ),
    },
  },
} as unknown as Config;

function getPreviewMerchant(context: PreviewMerchantContext): MerchantData {
  return {
    business_name: 'Preview Store',
    business_type: 'other',
    id: `preview-${context.id}-preview`,
    slug: 'preview-store',
    user_id: 'preview-user',
  };
}

function getPreviewMerchantContext(
  context: PreviewMerchantContext
): MerchantContextType {
  return {
    basePath: context.basePath,
    hasPermission: () => false,
    loading: false,
    merchant: getPreviewMerchant(context),
    navigationCategories: [],
    reloadMerchant: () => undefined,
    routingMode: 'path',
    staffAccess: {
      isOwner: false,
      isStaff: false,
      permissions: {},
      role: null,
    },
    updateMerchant: async () => undefined,
  };
}

function PreviewContext({
  children,
  merchantContext,
}: {
  children: ReactNode;
  merchantContext: PreviewMerchantContext;
}) {
  return (
    <MerchantContext.Provider
      value={getPreviewMerchantContext(merchantContext)}
    >
      <CartContext.Provider value={previewCart}>
        <StorefrontProvider>{children}</StorefrontProvider>
      </CartContext.Provider>
    </MerchantContext.Provider>
  );
}

function RenderCommit({ onRendered }: { onRendered: () => void }) {
  useEffect(() => onRendered(), [onRendered]);
  return null;
}

export function RenderBuilderConfig({
  config,
  merchantContext,
  onRendered,
}: RenderBuilderConfigProps) {
  const theme = getPreviewTheme(config);
  const previewData = getPreviewData(config, merchantContext);
  const previewRootTitle = getPreviewRootTitle(config.root);
  const themeTokens = getCuratedThemeTokenProjection(theme) as CSSProperties;
  return (
    <PreviewContext merchantContext={merchantContext}>
      <div
        data-base-path={merchantContext.basePath}
        data-testid="builder-preview-surface"
        style={{
          ...themeTokens,
          backgroundColor: 'var(--theme-background)',
          color: 'var(--theme-foreground)',
        }}
      >
        <PreviewNavigationGuard>
          <PreviewRootTitle title={previewRootTitle} />
          <Render config={previewBuilderConfig} data={previewData} />
        </PreviewNavigationGuard>
        {onRendered ? <RenderCommit onRendered={onRendered} /> : null}
      </div>
    </PreviewContext>
  );
}
