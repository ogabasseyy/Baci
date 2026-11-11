import { cookies } from 'next/headers';
import {
  ensurePermission,
  MerchantAuthenticationRequiredError,
} from '@/lib/merchant-server';
import { buildStoreUrl } from '@/lib/store-url';
import { buildHomeSeoDecision } from '@/lib/storefront-seo/build-home-seo-decision';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { createClient } from '@/lib/supabase/server';
import { buildStorefrontSearchReadinessAssessment } from './build-storefront-search-readiness-assessment';
import { countProductsMissingEffectivePublicImagesInPages } from './count-products-missing-effective-public-images-in-pages';
import { countProductsMissingUsableDescriptionsInPages } from './count-products-missing-usable-descriptions-in-pages';
import { hasPublishableTrustPolicy } from './has-publishable-trust-policy';

async function countRows(
  query: PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const CATEGORY_INTRO_PAGE_SIZE = 250;

async function countCategoriesMissingCustomIntro(
  getPage: (range: { from: number; to: number }) => PromiseLike<{
    data: Array<{
      seo_description: string | null;
      seo_heading: string | null;
    }> | null;
    error: { message: string } | null;
  }>
): Promise<number> {
  let count = 0;
  for (let from = 0; ; from += CATEGORY_INTRO_PAGE_SIZE) {
    const { data, error } = await getPage({
      from,
      to: from + CATEGORY_INTRO_PAGE_SIZE - 1,
    });
    if (error) throw new Error(error.message);
    const categories = data ?? [];
    count += categories.filter(
      (category) =>
        !category.seo_heading?.trim() && !category.seo_description?.trim()
    ).length;
    if (categories.length < CATEGORY_INTRO_PAGE_SIZE) return count;
  }
}

export async function getStorefrontSearchReadiness(merchantId: string) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new MerchantAuthenticationRequiredError();

  const { merchant } = await ensurePermission('marketing', 'view');
  if (merchant.id !== merchantId) throw new Error('Merchant mismatch');

  const [
    merchantResult,
    activeProducts,
    missingDescriptions,
    missingImages,
    missingCategoryDescriptions,
  ] = await Promise.all([
    supabase
      .from('merchants')
      .select(
        'business_name, is_published, slug, site_description, site_tagline, support_email, support_phone, trust_profile'
      )
      .eq('id', merchant.id)
      .maybeSingle(),
    countRows(
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
    ),
    countProductsMissingUsableDescriptionsInPages(({ from, to }) =>
      supabase
        .from('products')
        .select('description')
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to)
    ),
    countProductsMissingEffectivePublicImagesInPages(({ from, to }) =>
      supabase
        .from('products')
        .select(
          'images, product_variants!product_variants_product_id_fkey(primary_image, images, is_inventory_anchor, is_active, status, deleted_at, archived_at)'
        )
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to)
    ),
    countCategoriesMissingCustomIntro(({ from, to }) =>
      supabase
        .from('categories')
        .select('seo_heading, seo_description')
        .eq('merchant_id', merchant.id)
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to)
    ),
  ]);

  if (merchantResult.error || !merchantResult.data) {
    throw new Error(merchantResult.error?.message ?? 'Merchant not found');
  }
  const merchantFacts = merchantResult.data;
  const canonicalUrl = merchantFacts.slug?.trim()
    ? buildStoreUrl({
        slug: merchantFacts.slug,
        custom_domain: merchant.custom_domain,
      })
    : null;
  return buildStorefrontSearchReadinessAssessment({
    homeDecision: buildHomeSeoDecision({
      isPublished: merchantFacts.is_published === true,
      canonicalUrl,
      merchantName: merchantFacts.business_name ?? null,
    }),
    hasCustomStoreDescription: Boolean(
      merchantFacts.site_description?.trim() ||
        merchantFacts.site_tagline?.trim()
    ),
    hasPublicSupportContact: Boolean(
      merchantFacts.support_email?.trim() || merchantFacts.support_phone?.trim()
    ),
    hasPublishedTrustPolicy: hasPublishableTrustPolicy(
      buildMerchantTrustProfile({
        slug: merchantFacts.slug,
        trust_profile: merchantFacts.trust_profile,
      })
    ),
    activeProductCount: activeProducts,
    productsMissingDescriptionCount: missingDescriptions,
    productsMissingImageCount: missingImages,
    categoriesMissingCustomIntroCount: missingCategoryDescriptions,
  });
}
