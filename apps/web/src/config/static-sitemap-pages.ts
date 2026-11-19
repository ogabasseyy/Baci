export const STATIC_SITEMAP_PAGES = [
  { path: '/', changeFreq: 'weekly' as const, priority: 1.0 },
  { path: '/pricing', changeFreq: 'weekly' as const, priority: 0.9 },
  { path: '/features', changeFreq: 'monthly' as const, priority: 0.8 },
  { path: '/about', changeFreq: 'monthly' as const, priority: 0.7 },
  { path: '/contact', changeFreq: 'monthly' as const, priority: 0.6 },
  { path: '/blog', changeFreq: 'daily' as const, priority: 0.8 },
  { path: '/demo', changeFreq: 'monthly' as const, priority: 0.7 },
  { path: '/terms', changeFreq: 'yearly' as const, priority: 0.3 },
  { path: '/privacy', changeFreq: 'yearly' as const, priority: 0.3 },
] as const;
