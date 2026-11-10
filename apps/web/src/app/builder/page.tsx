import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { CopilotBuilderWrapper } from '@/components/builder/copilot-builder-wrapper';
import { CsrfInitializer } from '@/components/csrf-initializer';
import { StorefrontProvider } from '@/contexts/storefront-context';
import { MerchantProvider } from '@/hooks/merchant/merchant-provider';
import { readExperienceAuthoringMode } from '@/lib/experience/authoring-mode';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import BuilderClient from './builder-client';

export const metadata: Metadata = {
  title: 'Your AI-Powered Builder - Baci',
  description: 'Customize your storefront',
};

function BuilderPageFallback() {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
    >
      Loading builder…
    </div>
  );
}

async function ModeAwareBuilder() {
  if (getExperienceOwnerRuntime()?.approval) {
    const client = await createClient();
    const auth = await client.auth.getUser();
    if (!auth.error && auth.data.user) {
      const merchant = await getMerchantForApiRequest(
        client,
        auth.data.user.id
      );
      if (merchant) {
        const mode = await readExperienceAuthoringMode(
          client,
          merchant.merchantId
        );
        if (mode === 'full-code')
          redirect(
            `/builder/experience?merchant=${encodeURIComponent(merchant.merchantId)}`
          );
        if (mode === 'unavailable')
          return (
            <p role="alert">
              Builder mode is unavailable. Refresh before editing.
            </p>
          );
      }
    }
  }
  return <LegacyBuilder />;
}

function LegacyBuilder() {
  return (
    <MerchantProvider>
      <StorefrontProvider>
        <CsrfInitializer />
        <CopilotBuilderWrapper>
          <BuilderClient />
        </CopilotBuilderWrapper>
      </StorefrontProvider>
    </MerchantProvider>
  );
}
export default function BuilderPage() {
  return (
    <Suspense fallback={<BuilderPageFallback />}>
      {getExperienceOwnerRuntime()?.approval ? (
        <ModeAwareBuilder />
      ) : (
        <LegacyBuilder />
      )}
    </Suspense>
  );
}
