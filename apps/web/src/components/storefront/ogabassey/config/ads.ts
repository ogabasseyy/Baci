// Migrated from temp-source/adLocations/config.ts
export interface AdPlacement {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  mobileWidth: number;
  mobileHeight: number;
  /**
   * Eligible creative sizes at >=768px. Every entry must fit inside
   * `[width, height]` so the reserved `AdSlotShell` never shifts on fill.
   */
  desktopSizes?: ReadonlyArray<readonly [number, number]>;
  /**
   * Eligible creative sizes at <768px. Every entry must fit inside
   * `[mobileWidth, mobileHeight]` so the reserved `AdSlotShell` never shifts.
   */
  mobileSizes?: ReadonlyArray<readonly [number, number]>;
  type: 'banner' | 'sidebar' | 'in-feed' | 'sticky';
}

export const DEFERRED_SHELL_MOUNT_DELAY_MS = 1;
// `HOMEPAGE_STRIP` is already gated on real shopper interaction/scroll with
// `timeoutMs={0}`, so zero-interaction Lighthouse runs never boot GPT. Once a
// shopper scrolls or taps, boot immediately while the strip is still in view.
export const HOMEPAGE_STRIP_AD_BOOT_DELAY_MS = 0;
export const SPONSORED_SLIDE_AD_BOOT_DELAY_MS = 4000;
// The category carousel auto-advances every 6s with the ad in the second slot,
// so the ad must boot well before it rotates into view (~6s). Keep it past the
// initial paint but with enough lead time to fill before it's shown.
export const CATEGORY_CAROUSEL_AD_BOOT_DELAY_MS = 3000;

// Closed set of placements: `satisfies` keeps the literal keys, so a
// placement key that is not listed here fails to compile instead of
// silently rendering no ad.
export const AD_CONFIG = {
  // 1. HEADER LEADERBOARD (Standard)
  // Location: Top of pages, or inside the top Banner Carousel.
  // Standard: 728x90 (Desktop) | 320x100 (Mobile)
  HEADER_LEADERBOARD: {
    id: 'div-gpt-ad-header',
    // Must exactly match the Google Ad Manager ad unit code (case-sensitive);
    // the GAM unit was created as `Header_Leaderboard` and already has
    // impressions, so the app aligns to it rather than recreating the unit.
    name: 'Header_Leaderboard',
    description: 'High visibility top-of-page banner.',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    desktopSizes: [
      [728, 90],
      [468, 60],
    ],
    mobileSizes: [
      [320, 100],
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },

  // 2. HOMEPAGE STRIP (High Impact)
  // Location: Between Hero and Product Filters on Home.
  // Standard: 970x90 / 728x90 (Desktop) | 320x50 (Mobile)
  HOMEPAGE_STRIP: {
    id: 'div-gpt-ad-home-strip',
    name: 'homepage_large_strip',
    description: 'Wide banner separating hero content from products.',
    width: 970,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 50,
    desktopSizes: [
      [970, 90],
      [728, 90],
    ],
    mobileSizes: [
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },

  // 3. PRODUCT SIDEBAR (Half Page - High CPM)
  // Location: Product Details, Category, & Blog Article Sidebars.
  // Standard: 300x600 / 300x250 (Desktop) | 300x250 (Mobile)
  SIDEBAR_HALF_PAGE: {
    id: 'div-gpt-ad-sidebar-large',
    name: 'sidebar_half_page',
    description: 'Large vertical ad for product detail sidebars.',
    width: 300,
    height: 600,
    mobileWidth: 300,
    mobileHeight: 250,
    desktopSizes: [
      [300, 600],
      [300, 250],
      [160, 600],
    ],
    mobileSizes: [
      [300, 250],
      [250, 250],
    ],
    type: 'sidebar',
  },

  // 4. PRODUCT GRID (Medium Rectangle)
  // Location: Inside product lists.
  // Standard: 300x250 (Desktop & Mobile)
  PRODUCT_GRID_MPU: {
    id: 'div-gpt-ad-grid-mpu',
    name: 'in_feed_mpu',
    description: 'Square ad inserted naturally into product grids.',
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'in-feed',
  },

  // 5. CONTENT BREAK (Leaderboard)
  // Location: Between Product Description / Article Prose and Reviews.
  // Standard: 728x90 (Desktop) | 320x50 (Mobile)
  CONTENT_BREAK: {
    id: 'div-gpt-ad-content',
    name: 'content_section_break',
    description: 'Horizontal divider before deep content areas.',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 50,
    desktopSizes: [
      [728, 90],
      [468, 60],
    ],
    mobileSizes: [
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },

  // 6. CART SIDEBAR (Medium Rectangle)
  // Location: Bottom of Cart Drawer.
  // Standard: 300x250
  CART_MPU: {
    id: 'div-gpt-ad-cart',
    name: 'cart_drawer_mpu',
    description: 'Square ad visible during checkout flow.',
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'sidebar',
  },

  // 7. QUIZ QUESTION (Medium Rectangle)
  // Location: Between the active quiz question and answer options.
  // Standard: 300x250 (Desktop & Mobile)
  QUIZ_QUESTION_MPU: {
    id: 'div-gpt-ad-quiz-question',
    name: 'quiz_question_mpu',
    description: 'Question-level ad refreshed as shoppers advance in quizzes.',
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'in-feed',
  },

  // 8. FOOTER (Billboard/Leaderboard/MPU)
  // Location: Above footer. Accepts 970x250, 970x90, 728x90, and 300x250
  // inside the height-locked 250px desktop shell to eliminate no-fill waste.
  FOOTER_BANNER: {
    id: 'div-gpt-ad-footer',
    name: 'footer_banner',
    description: 'Large footer placement for ending the user journey.',
    width: 970,
    height: 250,
    mobileWidth: 320,
    mobileHeight: 100,
    desktopSizes: [
      [970, 250],
      [970, 90],
      [728, 90],
      [300, 250],
    ],
    mobileSizes: [
      [320, 100],
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },

  // 9. ORDER SUCCESS (High Engagement)
  // Location: On the Thank You page.
  // Standard: 728x90 (Desktop) | 320x100 (Mobile)
  ORDER_SUCCESS_BANNER: {
    id: 'div-gpt-ad-success',
    name: 'order_success_banner',
    description: 'Post-purchase placement for cross-selling or branding.',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    desktopSizes: [
      [728, 90],
      [468, 60],
    ],
    mobileSizes: [
      [320, 100],
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },

  // 10. BLOG SIDEBAR / IN-ARTICLE MPU (Standard MPU)
  // Location: Blog index grid & blog post inline breaks.
  // Standard: 300x250
  BLOG_SIDEBAR: {
    id: 'div-gpt-ad-blog-sidebar',
    name: 'blog_sidebar_mpu',
    description: 'Square ad in the blog sidebar or between grid items.',
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'sidebar',
  },

  // 11. NATIVE PRODUCT CARD (In-Feed Native)
  // Location: Inside product grids, styled to look like products
  // Type: Native (fluid size, custom template)
  NATIVE_PRODUCT_CARD: {
    id: 'div-gpt-native-product',
    name: 'native_product_card',
    description: 'Product-style native ad for seamless grid integration.',
    width: 300,
    height: 400,
    mobileWidth: 150,
    mobileHeight: 280,
    type: 'in-feed',
  },

  // 12. CATEGORY CAROUSEL BANNER
  // Location: Second slide of the category "recently added" carousel.
  // Banner-shaped so it fits the carousel height (~208px mobile) without
  // cropping. Standard: 728x90 (Desktop) | 320x100 (Mobile).
  CATEGORY_CAROUSEL_BANNER: {
    id: 'div-gpt-ad-category-carousel',
    // Must exactly match the Google Ad Manager ad unit code (case-sensitive).
    name: 'CATEGORY_CAROUSEL_BANNER',
    description: 'Banner ad inside the category recently-added carousel.',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    desktopSizes: [
      [728, 90],
      [468, 60],
    ],
    mobileSizes: [
      [320, 100],
      [320, 50],
      [300, 50],
    ],
    type: 'banner',
  },
} as const satisfies Record<string, AdPlacement>;

export type AdPlacementKey = keyof typeof AD_CONFIG;
