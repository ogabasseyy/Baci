import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import {
  type RepairBookingPreselection,
  RepairBookingWizard,
} from '@/components/storefront/RepairBookingWizard';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import type { CachedMerchant } from '@/lib/cached-data';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';
import { RepairBookingPrepSection } from './repair-booking-prep-section';

export interface RepairPageRouteProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{ device?: string; quote?: string }>;
}

export interface RepairPageContentProps extends RepairPageRouteProps {
  merchant: CachedMerchant | null;
  /** Set when the parent already committed the booking LCP intro. */
  omitIntro?: boolean;
  preselection?: RepairBookingPreselection;
}

export function canUseRepairBooking(
  merchant: CachedMerchant | null
): merchant is CachedMerchant {
  if (!merchant) {
    return false;
  }

  return (
    merchant.template_id === OGABASSEY_TEMPLATE_ID ||
    isRepairsCatalogEnabled({
      businessType: merchant.business_type,
      repairsCatalogEnabled: merchant.feature_settings?.repairs_catalog_enabled,
    })
  );
}

export async function RepairPageContent({
  merchant,
  omitIntro = false,
  params,
  preselection,
}: RepairPageContentProps) {
  const { slug } = await params;

  if (!canUseRepairBooking(merchant)) {
    notFound();
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/repair`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: 'Book a Repair', url: canonicalUrl },
  ]);

  const wizard = (
    <>
      <RepairBookingPrepSection />
      <div className="overflow-hidden rounded-xl border border-store-border bg-store-background-text/5 shadow-sm">
        <RepairBookingWizard
          merchantId={merchant.id}
          merchantSlug={slug}
          merchantName={merchant.business_name}
          preselection={preselection}
        />
      </div>
    </>
  );

  if (omitIntro) {
    return (
      <>
        <JsonLd data={breadcrumbSchema} />
        {wizard}
      </>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <JsonLd data={breadcrumbSchema} />
      <div className="mx-auto max-w-3xl">
        <RepairBookingLcpIntro />
        {wizard}
      </div>
    </div>
  );
}
