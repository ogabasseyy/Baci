import type { V2ThemeMode } from '@/components/storefront/ogabassey/providers/v2-theme-context';
import type { MerchantData } from '@/hooks/use-merchant';
import type { Product } from '@/lib/products';

/** Props passed to template page components. */
export interface TemplatePageProps {
  /** Store slug for routing */
  storeSlug?: string;
  /** Merchant data (real or mock) */
  merchant?: MerchantData;
  /** Products (real or mock) */
  products?: Product[];
  /** Whether this is a preview mode */
  isPreview?: boolean;
  /** Initial theme for SSR consistency (Phase 1: Cookie-Based Theme) */
  initialTheme?: V2ThemeMode;
  /** Categories loaded from DB */
  categories?: { name: string; slug: string }[];
}
