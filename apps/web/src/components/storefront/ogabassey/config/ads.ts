// Migrated from temp-source/adLocations/config.ts
export interface AdPlacement {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  mobileWidth: number;
  mobileHeight: number;
  type: 'banner' | 'sidebar' | 'in-feed' | 'sticky';
}

export const DEFERRED_SHELL_MOUNT_DELAY_MS = 1;
export const HOMEPAGE_STRIP_AD_BOOT_DELAY_MS = 12_000;
export const SPONSORED_SLIDE_AD_BOOT_DELAY_MS = 9000;
// The category carousel auto-advances every 6s with the ad in the second slot,
// so the ad must boot well before it rotates into view (~6s). Keep it past the
// initial paint but with enough lead time to fill before it's shown.
export const CATEGORY_CAROUSEL_AD_BOOT_DELAY_MS = 3000;

export const AD_CONFIG: Record<string, AdPlacement> = {
  // 1. HEADER LEADERBOARD (Standard)
  // Location: Top of pages, or inside the top Banner Carousel.
  // Standard: 728x90 (Desktop) | 320x100 (Mobile)
  HEADER_LEADERBOARD: {
    id: 'div-gpt-ad-header',
    // Must exactly match the Google Ad Manager ad unit code (case-sensitive);
    // the GAM unit was created as `Header_Leaderboard` and already has
    // impressions, so the app aligns to it rather than recreating the unit.
    name: 'Header_Leaderboard',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    type: 'banner',
  },

  // 2. HOMEPAGE STRIP (High Impact)
  // Location: Between Hero and Product Filters on Home.
  // Standard: 970x90 (Desktop) | 320x50 (Mobile)
  HOMEPAGE_STRIP: {
    id: 'div-gpt-ad-home-strip',
    name: 'homepage_large_strip',
    width: 970,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 50,
    type: 'banner',
  },

  // 3. PRODUCT SIDEBAR (Half Page - High CPM)
  // Location: Product Details Sidebar.
  // Standard: 300x600 (Desktop) | Hidden or 300x250 (Mobile)
  // Note: 300x600 is one of the fastest growing sizes by impression.
  SIDEBAR_HALF_PAGE: {
    id: 'div-gpt-ad-sidebar-large',
    name: 'sidebar_half_page',
    width: 300,
    height: 600,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'sidebar',
  },

  // 4. PRODUCT GRID (Medium Rectangle)
  // Location: Inside product lists (every 8 items).
  // Standard: 300x250 (Desktop & Mobile)
  // Note: The "MPU" (Mid-Page Unit) is the most compatible ad size.
  PRODUCT_GRID_MPU: {
    id: 'div-gpt-ad-grid-mpu',
    name: 'in_feed_mpu',
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'in-feed',
  },

  // 5. CONTENT BREAK (Leaderboard)
  // Location: Between Product Description and Reviews.
  // Standard: 728x90 (Desktop) | 320x50 (Mobile)
  CONTENT_BREAK: {
    id: 'div-gpt-ad-content',
    name: 'content_section_break',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 50,
    type: 'banner',
  },

  // 6. CART SIDEBAR (Medium Rectangle)
  // Location: Bottom of Cart Drawer.
  // Standard: 300x250
  CART_MPU: {
    id: 'div-gpt-ad-cart',
    name: 'cart_drawer_mpu',
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
    width: 300,
    height: 250,
    mobileWidth: 300,
    mobileHeight: 250,
    type: 'in-feed',
  },

  // 8. FOOTER (Billboard/Leaderboard)
  // Location: Just above footer.
  // Standard: 970x250 (Billboard) or 728x90
  FOOTER_BANNER: {
    id: 'div-gpt-ad-footer',
    name: 'footer_banner',
    width: 970,
    height: 250,
    mobileWidth: 320,
    mobileHeight: 100,
    type: 'banner',
  },

  // 9. ORDER SUCCESS (High Engagement)
  // Location: On the Thank You page.
  // Standard: 728x90 (Desktop) | 320x100 (Mobile)
  ORDER_SUCCESS_BANNER: {
    id: 'div-gpt-ad-success',
    name: 'order_success_banner',
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    type: 'banner',
  },

  // 10. BLOG SIDEBAR (Standard MPU)
  // Location: Sidebar of the Blog Index.
  // Standard: 300x250
  BLOG_SIDEBAR: {
    id: 'div-gpt-ad-blog-sidebar',
    name: 'blog_sidebar_mpu',
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
    width: 728,
    height: 90,
    mobileWidth: 320,
    mobileHeight: 100,
    type: 'banner',
  },
};
