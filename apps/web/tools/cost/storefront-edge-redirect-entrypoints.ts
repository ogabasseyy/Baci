/** Storefront entrypoints whose only supported behavior is canonical redirect. */
export const STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS = [
  '(content)/pages/about/page.tsx',
  '(content)/pages/blog/page.tsx',
  '(content)/pages/contact/page.tsx',
  '(content)/pages/faq/page.tsx',
  '(content)/pages/privacy/page.tsx',
  '(content)/pages/terms/page.tsx',
  '(content)/privacy-policy/page.tsx',
  '(content)/terms-and-conditions/page.tsx',
  '(content)/terms-of-service/page.tsx',
  'favicon.ico/route.ts',
  'news-sitemap.xml/route.ts',
] as const;
