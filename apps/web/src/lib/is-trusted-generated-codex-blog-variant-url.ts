import { getTrustedCdnSourcePath } from './get-trusted-cdn-source-path';
import { isTrustedGeneratedCodexBlogImageUrl } from './is-trusted-generated-codex-blog-image-url';

const VARIANT_FILENAME_EXTENSIONS = ['avif', 'jpg', 'jpeg', 'png', 'webp'];

// Whether a URL is the renderable file for a generated variant:
// the exact key filename or a prefixed name ending in -key or
// _key, matched case-insensitively so CDN-cased keys still bind.
export function isTrustedGeneratedCodexBlogVariantUrl(
  raw: string,
  variantKey: string
): boolean {
  if (!isTrustedGeneratedCodexBlogImageUrl(raw)) return false;
  const sourcePath = getTrustedCdnSourcePath(raw);
  const filename = sourcePath?.split('/').at(-1)?.toLowerCase() ?? '';
  const key = variantKey.toLowerCase();
  return VARIANT_FILENAME_EXTENSIONS.some(
    (extension) =>
      filename === `${key}.${extension}` ||
      filename.endsWith(`-${key}.${extension}`) ||
      filename.endsWith(`_${key}.${extension}`)
  );
}
