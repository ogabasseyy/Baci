'use client';

import { type Data, Render } from '@puckeditor/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader2 } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { builderConfig } from '@/components/builder/config';
import { leasePublicPuckThemeTokens } from '@/components/storefront/public-puck-theme-token-lease';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { useMerchant } from '@/hooks/use-merchant-client';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { getCuratedThemeTokenProjection } from '@/lib/storefront-defaults/curated-theme-token-projection';
import { createClient } from '@/lib/supabase/client';
import { defaultTheme, type ThemeConfiguration } from '@/lib/theme-config';
import { builderPublicHomeSchema } from '@/schemas/builder-public-home';
import { PublicPortableHome } from './portable/public-portable-home';

interface PuckStorefrontProps {
  onNoConfig?: () => void;
}

interface MerchantPuckData {
  data: Data;
  merchantId: string;
  publishedVersion: string | null;
}

interface MerchantPuckTheme {
  merchantId: string;
  theme: ThemeConfiguration;
}

function isThemeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const IS_DEV = process.env.NODE_ENV !== 'production';

function normalizeThemeConfiguration(
  defaults: ThemeConfiguration,
  overrides: Partial<ThemeConfiguration>
): ThemeConfiguration {
  const mergeIntoDefaults = (
    fallback: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> => {
    const merged: Record<string, unknown> = { ...fallback };

    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.hasOwn(fallback, key)) {
        continue;
      }

      const fallbackValue = fallback[key];
      if (isThemeObject(fallbackValue)) {
        if (isThemeObject(value)) {
          merged[key] = mergeIntoDefaults(fallbackValue, value);
        } else if (IS_DEV) {
          console.warn('Theme override type mismatch', {
            key,
            expectedType: 'object',
            receivedType: typeof value,
            receivedValue: value,
          });
        }
        continue;
      }

      if (typeof value === typeof fallbackValue) {
        merged[key] = value;
      } else if (IS_DEV) {
        console.warn('Theme override type mismatch', {
          key,
          expectedType: typeof fallbackValue,
          receivedType: typeof value,
          receivedValue: value,
        });
      }
    }

    return merged;
  };

  return mergeIntoDefaults(
    defaults as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>
  ) as unknown as ThemeConfiguration;
}

interface LoadPuckConfigParams {
  merchantId: string;
  onNoConfig?: () => void;
  setPuckData: (data: Data, publishedVersion: string | null) => void;
  setPuckTheme: (theme: ThemeConfiguration | null) => void;
  setLoading: (loading: boolean) => void;
}

// Module-scope helper so the try/finally, throw, and dynamic import() stay
// outside the component body (React Compiler cannot lower those constructs).
async function loadPuckConfig({
  merchantId,
  onNoConfig,
  setPuckData,
  setPuckTheme,
  setLoading,
}: LoadPuckConfigParams): Promise<void> {
  try {
    const supabase = createClient();

    // Fetch published Puck config
    const response = BUILDER_PRIVATE_STORAGE_ENABLED
      ? await (supabase as SupabaseClient).rpc(
          'builder_public_home',
          { p_merchant: merchantId },
          { get: true }
        )
      : await supabase
          .from('page_configs')
          .select('published_config')
          .eq('merchant_id', merchantId)
          .eq('page_slug', 'home')
          .single();
    const fetchError = response.error;
    let boundVersion: string | null = null;
    let pageConfig: { published_config: unknown } | null = null;
    if (!fetchError && response.data) {
      if (BUILDER_PRIVATE_STORAGE_ENABLED) {
        const published = builderPublicHomeSchema.parse(response.data);
        pageConfig = { published_config: published.config };
        boundVersion = published.publishedVersion;
      } else
        pageConfig = z
          .object({ published_config: z.unknown() })
          .parse(response.data);
    }

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        // No config found - trigger fallback
        onNoConfig?.();
      } else {
        throw fetchError;
      }
    } else if (pageConfig?.published_config) {
      setPuckData(pageConfig.published_config as Data, boundVersion);

      // Apply theme if it exists
      const configWithTheme = pageConfig.published_config as {
        theme?: Partial<ThemeConfiguration>;
      };
      if (configWithTheme.theme) {
        const { validateTheme } = await import('@/lib/theme-manager');
        const normalizedTheme = normalizeThemeConfiguration(
          defaultTheme,
          configWithTheme.theme
        );
        if (validateTheme(normalizedTheme)) {
          setPuckTheme(normalizedTheme);
        }
      }
    } else {
      // Config exists but is empty
      onNoConfig?.();
    }
  } catch (err) {
    console.error('Failed to load Puck config:', err);
    onNoConfig?.();
  } finally {
    setLoading(false);
  }
}

export function PuckStorefront({ onNoConfig }: PuckStorefrontProps) {
  const { merchant, basePath } = useMerchant();
  const onNoConfigRef = useRef(onNoConfig);
  const [puckData, setPuckData] = useState<MerchantPuckData | null>(null);
  const [puckTheme, setPuckTheme] = useState<MerchantPuckTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const merchantId = merchant?.id ?? null;
  const activePuckData =
    puckData?.merchantId === merchantId ? puckData.data : null;
  const activePuckTheme =
    puckTheme?.merchantId === merchantId ? puckTheme.theme : null;
  onNoConfigRef.current = onNoConfig;

  useEffect(() => {
    let active = true;
    setPuckData(null);
    setPuckTheme(null);
    if (!merchantId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);

    loadPuckConfig({
      merchantId,
      onNoConfig: () => {
        if (active) onNoConfigRef.current?.();
      },
      setPuckData: (data, publishedVersion) => {
        if (active) setPuckData({ data, merchantId, publishedVersion });
      },
      setPuckTheme: (theme) => {
        if (active && theme) setPuckTheme({ merchantId, theme });
      },
      setLoading: (nextLoading) => {
        if (active) setLoading(nextLoading);
      },
    });
    return () => {
      active = false;
    };
  }, [merchantId]);

  useEffect(() => {
    if (!activePuckTheme) return;
    return leasePublicPuckThemeTokens(
      document.documentElement,
      getCuratedThemeTokenProjection(activePuckTheme)
    ).release;
  }, [activePuckTheme]);

  if (loading) {
    return (
      <div
        className="flex h-screen w-full items-center justify-center"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <Loader2
          className="size-8 motion-safe:animate-spin"
          aria-label="Loading store"
        />
      </div>
    );
  }

  // If no Puck data, return null (fallback will be shown)
  if (!activePuckData) {
    return null;
  }

  // Explicit capability opt-in; unmarked legacy Puck keeps its existing renderer.
  const root = activePuckData.root as { props?: { rendererVersion?: unknown } };
  if (root?.props && Object.hasOwn(root.props, 'rendererVersion')) {
    return (
      <PublicPortableHome
        config={activePuckData}
        publishedVersion={
          puckData?.merchantId === merchantId ? puckData.publishedVersion : null
        }
        merchant={{
          id: merchant?.id,
          template_id: merchant?.template_id,
          slug: merchant?.slug,
          business_name: merchant?.business_name,
          logo_url: merchant?.logo_url ?? null,
          currency: resolveMerchantCurrencyConfig(merchant ?? {}).code,
        }}
        basePath={basePath ?? ''}
      />
    );
  }

  // Render using Puck
  return (
    <div
      style={
        activePuckTheme
          ? ({
              backgroundColor: 'var(--theme-background)',
              color: 'var(--theme-foreground)',
              ...getCuratedThemeTokenProjection(activePuckTheme),
            } as CSSProperties)
          : undefined
      }
    >
      <Render config={builderConfig} data={activePuckData} />
    </div>
  );
}
