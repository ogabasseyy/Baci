import { getTrustedCdnSourcePath } from './get-trusted-cdn-source-path';

const GENERATED_CODEX_BLOG_IMAGE_PREFIX = '/core-assets/blog/codex/';
const RENDERABLE_IMAGE_EXTENSION_PATTERN = /\.(avif|jpe?g|png|webp)$/i;

// Generated Codex images sort under a fixed CDN prefix. Transform
// segments resolve to the source first, `..` traversal fails
// closed, and only browser-renderable extensions count (no SVG:
// active content must never pass an image-URL check).
export function isTrustedGeneratedCodexBlogImageUrl(raw: string): boolean {
  const sourcePath = getTrustedCdnSourcePath(raw);
  if (sourcePath === null) return false;
  if (!sourcePath.startsWith(GENERATED_CODEX_BLOG_IMAGE_PREFIX)) return false;
  if (sourcePath.includes('..')) return false;
  return RENDERABLE_IMAGE_EXTENSION_PATTERN.test(sourcePath);
}
