import type { MerchantTrustProfileSource } from '@/lib/storefront-trust/merchant-trust-profile-types';
import type { MerchantAboutPage } from '@/types/about-page';

export type SitemapStaticMerchant = MerchantTrustProfileSource & {
  business_name?: string | null;
  is_published?: boolean | null;
  slug: string;
  updated_at?: string | null;
  template_id?: string | null;
  about_page?: MerchantAboutPage | null;
  faq_items?: unknown;
  pages?: {
    about?: string | null;
    contact?: string | null;
    faq?: string | null;
  } | null;
  email?: string | null;
  phone?: string | null;
};
