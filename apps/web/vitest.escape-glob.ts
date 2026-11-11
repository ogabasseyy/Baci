/**
 * Escapes glob syntax so a folder or file path matches literally. Folder names
 * are real paths, but Next.js route groups `(storefront)` and dynamic segments
 * `[slug]` would otherwise be read as glob syntax by Vitest's file matching.
 */
export function escapeGlob(value: string): string {
  return value.replace(/[()[\]{}!*?+@\\]/g, '\\$&');
}
