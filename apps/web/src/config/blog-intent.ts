/** Platform blog post intent taxonomy shared by validation, import, and editor UI. */
export const BLOG_INTENTS = [
  'news',
  'comparison',
  'repair-guide',
  'buying-guide',
  'platform',
  'unknown',
] as const;
export type BlogIntent = (typeof BLOG_INTENTS)[number];
