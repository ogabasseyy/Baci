/**
 * @fileOverview Centralized Template Registry - Single Source of Truth
 *
 * This file defines all available storefront templates in the Baci platform.
 * Template creators should register new templates here to make them available
 * for preview and production use.
 *
 * @example
 * ```typescript
 * import { TEMPLATE_REGISTRY, getTemplate } from '@/templates/registry';
 *
 * const template = getTemplate('ogabassey-v2');
 * if (template) {
 *   console.log(template.name); // "Ogabassey V2"
 * }
 * ```
 */

import type { ComponentType, ReactNode } from 'react';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import type { MerchantData } from '@/hooks/use-merchant';
import type { Product } from '@/lib/products';
import type { TemplateBlogPageProps } from './template-blog-types';
import type { TemplatePageProps } from './template-page-props';

export type { BlogPostData, TemplateBlogPageProps } from './template-blog-types';
export type { TemplatePageProps } from './template-page-props';

/**
 * Template status - controls visibility and access
 */
export type TemplateStatus = 'production' | 'beta' | 'draft';

/**
 * Template category for filtering and organization
 */
export type TemplateCategory =
  | 'gadgets'
  | 'fashion'
  | 'general'
  | 'food'
  | 'services'
  | 'beauty'
  | 'health'
  | 'home';

/**
 * Engine integration flags - indicates which e-commerce features work
 */
export interface EngineIntegration {
  /** Uses real product API from Supabase */
  products: boolean;
  /** Cart add/remove/update works */
  cart: boolean;
  /** Full checkout flow works */
  checkout: boolean;
  /** Customer authentication works */
  customerAuth: boolean;
  /** Wishlist functionality works */
  wishlist: boolean;
  /** Order tracking works */
  orderTracking: boolean;
}

/**
 * Template component references
 */
export interface TemplateComponents {
  /** Main home page component */
  Home: ComponentType<TemplatePageProps>;
  /** Product detail page (optional, uses default if not provided) */
  ProductDetail?: ComponentType<TemplatePageProps>;
  /** Cart page (optional, uses default if not provided) */
  Cart?: ComponentType<TemplatePageProps>;
  /** Checkout page (optional, uses default if not provided) */
  Checkout?: ComponentType<TemplatePageProps>;
  /** Category page (optional, uses default if not provided) */
  Category?: ComponentType<TemplatePageProps>;
  /** Layout wrapper (optional) */
  Layout?: ComponentType<{ children: ReactNode }>;

  // Informational Pages
  About?: ComponentType<TemplatePageProps>;
  Contact?: ComponentType<TemplatePageProps>;
  Privacy?: ComponentType<TemplatePageProps>;
  Terms?: ComponentType<TemplatePageProps>;
  Legal?: ComponentType<TemplatePageProps>;
  Sustainability?: ComponentType<TemplatePageProps>;
  Repairs?: ComponentType<TemplatePageProps>;
  Swap?: ComponentType<TemplatePageProps>;
  Help?: ComponentType<TemplatePageProps>;
  /** Delete account page (optional) */
  DeleteAccount?: ComponentType<TemplatePageProps>;
  /** Blog listing page (optional, uses default if not provided) */
  Blog?: ComponentType<TemplateBlogPageProps>;
}

/**
 * Mock data for template preview
 */
export interface TemplateMockData {
  /** Mock merchant data for preview */
  merchant: MerchantData;
  /** Mock products for preview (optional, uses shared mock if not provided) */
  products?: Product[];
}

/**
 * Complete template definition
 */
export interface TemplateDefinition {
  /** Unique identifier (used in URLs) */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Preview thumbnail URL (optional) */
  thumbnail?: string;
  /** Template category */
  category: TemplateCategory;
  /** Current development status */
  status: TemplateStatus;
  /** Version string */
  version: string;
  /** Author/creator */
  author?: string;
  /** Engine integration status */
  engine: EngineIntegration;
  /** Component exports - lazy loaded */
  getComponents: () => Promise<TemplateComponents>;
  /** Mock data for preview mode */
  mockData: TemplateMockData;
  /** Tags for search/filtering */
  tags?: string[];
  /** Date created */
  createdAt?: string;
  /** Date last updated */
  updatedAt?: string;
}

// =============================================================================
// DEFAULT MOCK MERCHANT DATA
// =============================================================================

const defaultMockMerchant: MerchantData = {
  id: 'preview-merchant',
  user_id: 'preview-user',
  business_name: 'Template Preview Store',
  business_type: 'GADGETS',
  logo_url: undefined,
  brand_colors: {
    primary: '#3B82F6',
    background: '#FFFFFF',
    accent: '#10B981',
  },
  country: 'NG',
  slug: 'template-preview',
  published_config: null,
};

// =============================================================================
// TEMPLATE REGISTRY
// =============================================================================

/**
 * All registered templates
 *
 * To add a new template:
 * 1. Create your template folder in /src/templates/[template-name]/
 * 2. Add an entry here with status: 'draft'
 * 3. Preview at /template-preview/[template-name]
 * 4. When ready, change status to 'beta' or 'production'
 */
export const TEMPLATE_REGISTRY: Record<string, TemplateDefinition> = {
  // ---------------------------------------------------------------------------
  // PRODUCTION TEMPLATES
  // ---------------------------------------------------------------------------

  'electronics': {
    id: 'electronics',
    name: 'Electronics Store',
    description: 'Standard template for electronics and gadget stores',
    thumbnail: '/template-previews/electronics.png',
    category: 'gadgets',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: true,
      wishlist: false,
      orderTracking: true,
    },
    getComponents: async () => {
      const { GadgetDefaultTemplate } = await import(
        '@/components/storefront/templates/gadget-default-template'
      );
      return {
        Home: GadgetDefaultTemplate as ComponentType<TemplatePageProps>,
      };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'electronics-preview',
        business_name: 'TechZone Store',
        business_type: 'ELECTRONICS',
        brand_colors: {
          primary: '#2563EB',
          background: '#F8FAFC',
          accent: '#0891B2',
        },
      },
    },
    tags: ['electronics', 'tech', 'gadgets', 'modern'],
  },

  'fashion': {
    id: 'fashion',
    name: 'Fashion Store',
    description: 'Elegant template for fashion and luxury brands',
    thumbnail: '/template-previews/fashion.png',
    category: 'fashion',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: true,
      wishlist: false,
      orderTracking: true,
    },
    getComponents: async () => {
      const { PremiumDefaultTemplate } = await import(
        '@/components/storefront/templates/premium-default'
      );
      return {
        Home: PremiumDefaultTemplate as ComponentType<TemplatePageProps>,
      };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'fashion-preview',
        business_name: 'Luxe Fashion',
        business_type: 'FASHION',
        brand_colors: {
          primary: '#1F2937',
          background: '#FAFAFA',
          accent: '#D4AF37',
        },
      },
    },
    tags: ['fashion', 'luxury', 'elegant', 'premium'],
  },

  'home-goods': {
    id: 'home-goods',
    name: 'Haven Home',
    description: 'Warm, lifestyle-focused template for furniture and home decor stores',
    thumbnail: '/template-previews/home-goods.png',
    category: 'home',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { HomeGoodsHome } = await import('./home-goods');
      return { Home: HomeGoodsHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'home-goods-preview',
        business_name: 'Haven Home',
        business_type: 'HOME_GOODS',
        brand_colors: {
          primary: '#8B4513',
          background: '#FAF8F5',
          accent: '#D4A574',
        },
      },
    },
    tags: ['home', 'furniture', 'decor', 'lifestyle', 'warm'],
  },

  'food-beverage': {
    id: 'food-beverage',
    name: 'Artisan Kitchen',
    description: 'Warm, rustic template for gourmet food e-commerce with dietary filters and recipe inspiration',
    thumbnail: '/template-previews/food-beverage.png',
    category: 'food',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { FoodBeverageHome } = await import('./food-beverage');
      return { Home: FoodBeverageHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'food-beverage-preview',
        business_name: 'Artisan Kitchen',
        business_type: 'FOOD_BEVERAGE',
        brand_colors: {
          primary: '#D2691E',
          background: '#FFF8E7',
          accent: '#556B2F',
        },
      },
    },
    tags: ['food', 'gourmet', 'organic', 'artisan', 'recipes'],
  },

  'health-beauty': {
    id: 'health-beauty',
    name: 'Health & Beauty Store',
    description: 'Minimalist luxury template for health & beauty brands with skin quiz and ingredient focus',
    thumbnail: '/template-previews/health-beauty.png',
    category: 'beauty',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { BeautyHome } = await import('./beauty');
      return { Home: BeautyHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'health-beauty-preview',
        business_name: 'Radiant Beauty',
        business_type: 'HEALTH_BEAUTY',
        brand_colors: {
          primary: '#FFD6E8',
          background: '#FAF9F6',
          accent: '#B76E79',
        },
      },
    },
    tags: ['beauty', 'skincare', 'wellness', 'luxury', 'minimalist'],
  },

  'hair-extensions': {
    id: 'hair-extensions',
    name: 'Glamour Hair Studio',
    description: 'Dark luxury template for hair extensions and wigs with texture/length filters and tutorials',
    thumbnail: '/template-previews/hair-extensions.png',
    category: 'beauty',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { HairExtensionsHome } = await import('./hair-extensions');
      return { Home: HairExtensionsHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'hair-extensions-preview',
        business_name: 'Glamour Hair Studio',
        business_type: 'HAIR_EXTENSIONS',
        brand_colors: {
          primary: '#B76E79',
          background: '#1A1A1A',
          accent: '#F5D0C5',
        },
      },
    },
    tags: ['hair', 'extensions', 'wigs', 'beauty', 'glamour'],
  },

  'pharmaceuticals': {
    id: 'pharmaceuticals',
    name: 'Pharmaceuticals Store',
    description: 'Professional pharmacy template with trust signals and prescription upload',
    thumbnail: '/template-previews/pharmaceuticals.png',
    category: 'health',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { PharmaceuticalHome } = await import('./pharmaceutical');
      return { Home: PharmaceuticalHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'pharmaceuticals-preview',
        business_name: 'MedCare Pharmacy',
        business_type: 'PHARMACEUTICALS',
        brand_colors: {
          primary: '#2563EB',
          background: '#FFFFFF',
          accent: '#10B981',
        },
      },
    },
    tags: ['pharmacy', 'medical', 'healthcare', 'professional', 'trust'],
  },

  // ---------------------------------------------------------------------------
  // BETA TEMPLATES
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // PRODUCTION TEMPLATES (Continued)
  // ---------------------------------------------------------------------------

  'gadget-universe': {
    id: 'gadget-universe',
    name: 'Gadget Universe',
    description: 'Dynamic block-based template for modern electronics retailers',
    thumbnail: '/template-previews/gadget-universe.png',
    category: 'gadgets',
    status: 'production',
    version: '1.0.0',
    author: 'Baci Team',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: true,
      wishlist: true,
      orderTracking: true,
    },
    tags: ['gadgets', 'dark', 'modern', 'advanced'],
    updatedAt: '2024-12-05',
    getComponents: async () => {
      const { GadgetUniverseTemplate } = await import(
        '@/components/storefront/templates/gadget-universe'
      );
      return {
        Home: GadgetUniverseTemplate as React.ComponentType<any>,
      };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'gadget-universe-preview',
        business_name: 'Gadget Universe',
      },
    },
  },

  [OGABASSEY_TEMPLATE_ID]: {
    id: OGABASSEY_TEMPLATE_ID,
    name: 'Ogabassey',
    description: 'Premium gadget store template with hero carousel, utility panel, advanced product grid, and full e-commerce engine integration',
    thumbnail: '/template-previews/ogabassey.png',
    category: 'gadgets',
    status: 'production',
    version: '2.0.0',
    author: 'Baci Team',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: true,
      wishlist: true,
      orderTracking: true,
    },
    tags: ['gadgets', 'electronics', 'premium', 'dark', 'carousel', 'featured'],
    createdAt: '2024-12-07',
    updatedAt: '2024-12-08',
    getComponents: async () => {
      const {
        OgabasseyHomePage,
      } = await import('@/components/storefront/ogabassey/pages/home');
      const { createOgabasseyHomeProductFeed } = await import(
        '@/components/storefront/ogabassey/home-product-feed'
      );

      // Import optional pages
      const { OgabasseyV2AboutUs } = await import('@/components/storefront/ogabassey/pages/about-us');
      const { OgabasseyV2PrivacyPolicy } = await import('@/components/storefront/ogabassey/pages/privacy-policy');
      const { OgabasseyV2LegalDispute } = await import('@/components/storefront/ogabassey/pages/legal-dispute');
      const { OgabasseyV2Sustainability } = await import('@/components/storefront/ogabassey/pages/sustainability');
      const { OgabasseyV2Repairs } = await import('@/components/storefront/ogabassey/pages/repairs');
      const { OgabasseyV2Swap } = await import('@/components/storefront/ogabassey/pages/swap');
      const { OgabasseyV2HelpSupport } = await import('@/components/storefront/ogabassey/pages/help-support');
      const { OgabasseyV2Blog } = await import('@/components/storefront/ogabassey/pages/blog');

      // Wrapper component
      const OgabasseyHome: React.ComponentType<TemplatePageProps> = (props) => {
        const homeProducts = props.products
          ? createOgabasseyHomeProductFeed(props.products)
          : [];

        return (
          <OgabasseyHomePage
            storeSlug={props.storeSlug}
            products={homeProducts}
            categories={props.categories}
          />
        );
      };

      // Wrapper factory for pages
      const createWrappedPage = <P extends TemplatePageProps>(Component: React.ComponentType<P>) => {
        return (props: P) => (
          <Component {...props} />
        );
      };

      return {
        Home: OgabasseyHome,
        About: createWrappedPage(OgabasseyV2AboutUs),
        Privacy: createWrappedPage(OgabasseyV2PrivacyPolicy),
        Legal: createWrappedPage(OgabasseyV2LegalDispute), // Maps to Terms/Legal
        Terms: createWrappedPage(OgabasseyV2LegalDispute),
        Sustainability: createWrappedPage(OgabasseyV2Sustainability),
        Repairs: createWrappedPage(OgabasseyV2Repairs),
        Swap: createWrappedPage(OgabasseyV2Swap),
        Help: createWrappedPage(OgabasseyV2HelpSupport),
        Contact: createWrappedPage(OgabasseyV2HelpSupport),
        Blog: createWrappedPage(OgabasseyV2Blog),
      };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'ogabassey-preview',
        business_name: 'Ogabassey',
        business_type: 'ELECTRONICS',
        brand_colors: {
          primary: '#DC2626',
          background: '#FFFFFF',
          accent: '#0F0F0F',
        },
      },
    },
  },

  // ---------------------------------------------------------------------------
  // DRAFT TEMPLATES (Work in Progress)
  // ---------------------------------------------------------------------------

  'gadgets-pro': {
    id: 'gadgets-pro',
    name: 'Tech Store Pro',
    description: 'Modern dark-themed electronics storefront with interactive product grid and price negotiation',
    thumbnail: '/template-previews/gadgets-pro.png',
    category: 'gadgets',
    status: 'production',
    version: '1.0.0',
    author: 'Baci Team',
    engine: {
      products: true, // Now supports engine products via EngineProductGrid
      cart: true, // Uses Baci cart system
      checkout: false,
      customerAuth: false,
      wishlist: true, // Uses Baci saved/wishlist system
      orderTracking: false,
    },
    getComponents: async () => {
      const { Home } = await import(
        '@/components/storefront/new-template/home'
      );
      return {
        Home: Home as ComponentType<TemplatePageProps>,
      };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'gadgets-pro-preview',
        business_name: 'Tech Store Pro',
        business_type: 'GADGETS',
        brand_colors: {
          primary: '#DC2626',
          background: '#0F0F0F',
          accent: '#111827',
        },
      },
    },
    tags: ['gadgets', 'tech', 'electronics', 'dark', 'modern'],
    createdAt: '2024-12-04',
    updatedAt: '2024-12-07',
  },

  'handmade': {
    id: 'handmade',
    name: 'Handmade Store',
    description:
      'Warm, authentic template for handcrafted and artisan products with maker story and custom orders',
    thumbnail: '/template-previews/handmade.png',
    category: 'general',
    status: 'production',
    version: '1.0.0',
    engine: {
      products: true,
      cart: true,
      checkout: true,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const { HandmadeHome } = await import('./artisan');
      return { Home: HandmadeHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'handmade-preview',
        business_name: 'The Artisan Collective',
        business_type: 'HANDMADE',
        brand_colors: {
          primary: '#C4785E',
          background: '#FAF6F1',
          accent: '#7D8B6C',
        },
      },
    },
    tags: ['artisan', 'handmade', 'crafts', 'boutique', 'maker'],
  },

  modern: {
    id: 'modern',
    name: 'Modern',
    description: 'Clean, minimalist template for contemporary brands',
    category: 'fashion',
    status: 'draft',
    version: '0.1.0',
    engine: {
      products: false,
      cart: false,
      checkout: false,
      customerAuth: false,
      wishlist: false,
      orderTracking: false,
    },
    getComponents: async () => {
      const ModernHome: ComponentType<TemplatePageProps> = (props) => {
        return (
          <div className="min-h-screen bg-white">
            <div className="max-w-6xl mx-auto py-20 px-6">
              <h1 className="text-6xl font-light tracking-tight text-gray-900 mb-4">
                {props.merchant?.business_name || 'Modern Store'}
              </h1>
              <p className="text-xl text-gray-500 mb-12">
                Less is more. Quality over quantity.
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="aspect-square bg-gray-100 rounded-sm" />
                ))}
              </div>
              <div className="mt-12 p-8 border border-gray-200 rounded-sm">
                <p className="text-gray-600 text-center">
                  ✨ Modern template coming soon. Clean lines, lots of whitespace,
                  and contemporary aesthetics.
                </p>
              </div>
            </div>
          </div>
        );
      };
      return { Home: ModernHome };
    },
    mockData: {
      merchant: {
        ...defaultMockMerchant,
        id: 'modern-preview',
        business_name: 'Modern Studio',
        business_type: 'FASHION',
        brand_colors: {
          primary: '#111827',
          background: '#FFFFFF',
          accent: '#6B7280',
        },
      },
    },
    tags: ['modern', 'minimal', 'clean', 'contemporary', 'work-in-progress'],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get a template by ID
 */
export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATE_REGISTRY[id];
}

/**
 * Get all templates
 */
export function getAllTemplates(): TemplateDefinition[] {
  return Object.values(TEMPLATE_REGISTRY);
}

/**
 * Get all template IDs
 */
export function getAllTemplateIds(): string[] {
  return Object.keys(TEMPLATE_REGISTRY);
}

/**
 * Get the recommended template ID for a specific business type
 */
export function getTemplateIdByBusinessType(businessType?: string): string {
  if (!businessType) return 'electronics';

  const normalized = businessType.toUpperCase();

  switch (normalized) {
    case 'ELECTRONICS':
    case 'GADGETS':
      return 'electronics';
    case 'FASHION':
      return 'fashion';
    case 'HOME_GOODS':
      return 'home-goods';
    case 'FOOD_BEVERAGE':
      return 'food-beverage';
    case 'HEALTH_BEAUTY':
      return 'health-beauty';
    case 'HAIR_EXTENSIONS':
      return 'hair-extensions';
    case 'PHARMACEUTICALS':
      return 'pharmaceuticals';
    case 'HANDMADE':
      return 'handmade';
    default:
      return 'electronics';
  }
}
