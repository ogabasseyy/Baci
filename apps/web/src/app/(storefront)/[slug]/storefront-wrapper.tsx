'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { AnalyticsProvider } from '@/components/analytics/analytics-provider';
import type { V2ThemeMode } from '@/components/storefront/ogabassey/providers/v2-theme-context';
import { Button } from '@/components/ui/button';
import { StorefrontPageSkeleton } from '@/components/ui/skeletons';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import type { Product } from '@/lib/products';
import type { TemplatePageProps } from '@/templates/registry';

const DynamicPuckStorefront = dynamic(
  () =>
    import('@/components/storefront/puck-storefront').then(
      (mod) => mod.PuckStorefront
    ),
  { ssr: false } // Client-side only rendering
);

interface StorefrontWrapperProps {
  products?: Product[];
  /** Initial theme for SSR consistency (Phase 1: Cookie-Based Theme) */
  initialTheme?: V2ThemeMode;
  /** Categories loaded from DB */
  categories?: { name: string; slug: string }[];
}

/**
 * Wrapper that renders the appropriate storefront template based on merchant's template_id.
 * Falls back to Puck storefront if no template_id is set or template not found.
 */
export function StorefrontWrapper({
  products = [],
  categories = [],
  initialTheme,
}: StorefrontWrapperProps) {
  // Use safe hook to prevent SSR hydration errors when context isn't yet available
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant ?? null;
  const loading = merchantContext?.loading ?? true;
  const [showError, setShowError] = useState(false);
  const [TemplateHome, setTemplateHome] =
    useState<React.ComponentType<TemplatePageProps> | null>(null);
  const [templateLoading, setTemplateLoading] = useState(true);

  // Define callback before conditional returns to satisfy React hooks rules
  const handleNoConfig = () => {
    setShowError(true);
  };

  // Load template components based on merchant's template_id
  useEffect(() => {
    const loadTemplate = async () => {
      if (loading) return;

      try {
        // The template registry (all storefront templates and their page
        // components) loads on demand so it never joins the initial bundle of
        // routes that only sometimes render a registry template (e.g. the
        // statically-rendered Ogabassey homepage). The skeleton stays up until
        // this resolves, so loading UX is unchanged.
        const { getTemplate, getTemplateIdByBusinessType } = await import(
          '@/templates/registry'
        );

        let templateId = merchant?.template_id;

        // If no template_id or it's 'default', use business_type fallback
        if (!templateId || templateId === 'default') {
          const fallbackId = getTemplateIdByBusinessType(
            merchant?.business_type
          );
          console.log(
            `No template_id set for "${merchant?.business_name}", using business_type fallback: ${fallbackId}`
          );
          templateId = fallbackId;
        }

        // If it's explicitly 'puck', use Puck storefront
        if (templateId === 'puck') {
          setTemplateHome(null);
          setTemplateLoading(false);
          return;
        }

        // Try to load the template from registry
        const template = getTemplate(templateId);
        if (!template) {
          console.warn(
            `Template "${templateId}" not found in registry, falling back to Puck`
          );
          setTemplateHome(null);
          setTemplateLoading(false);
          return;
        }

        try {
          const components = await template.getComponents();
          setTemplateHome(() => components.Home);
          setTemplateLoading(false);
        } catch (error) {
          console.error('Failed to load template:', templateId, error);
          setTemplateHome(null);
          setTemplateLoading(false);
        }
      } catch (error) {
        // A rejected registry chunk (offline/stale deployment) must fall
        // back to Puck like any other template failure — never strand the
        // page on the skeleton with an unsettled loading state.
        console.error('Failed to load template registry:', error);
        setTemplateHome(null);
        setTemplateLoading(false);
      }
    };

    loadTemplate();
  }, [
    merchant?.template_id,
    loading,
    merchant?.business_name,
    merchant?.business_type,
  ]);

  // Show loading state
  if (loading || templateLoading) {
    return <StorefrontPageSkeleton />;
  }

  if (showError) {
    return (
      <div
        className="flex flex-col min-h-screen items-center justify-center bg-background text-center px-4"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl mb-4">
          Store Not Set Up
        </h1>
        <p className="max-w-[600px] text-muted-foreground md:text-xl mb-8">
          Your store hasn't been set up yet. Please complete the onboarding
          process or visit the builder to create your store template.
        </p>
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/onboarding">Complete Onboarding</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/builder">Open Builder</Link>
          </Button>
        </div>
      </div>
    );
  }

  // If we have a template component, render it
  if (TemplateHome) {
    return (
      <>
        <AnalyticsProvider />
        <Suspense fallback={<StorefrontPageSkeleton />}>
          <TemplateHome
            storeSlug={merchant?.slug}
            merchant={merchant || undefined}
            products={products}
            categories={categories}
            isPreview={false}
            initialTheme={initialTheme}
          />
        </Suspense>
      </>
    );
  }

  // Fall back to Puck storefront
  return (
    <>
      <AnalyticsProvider />
      <DynamicPuckStorefront onNoConfig={handleNoConfig} />
    </>
  );
}
