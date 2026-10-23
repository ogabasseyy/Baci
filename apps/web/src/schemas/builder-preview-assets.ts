import { z } from 'zod';
/** Static image origins only. Signed/private storage URLs are never preview data. */
export const BUILDER_PREVIEW_ASSET_ORIGINS = [
  'https://usebaci.com',
  'https://cdn.ogabassey.com',
  'https://ogabassey.com',
  'https://*.supabase.co',
] as const;
export function isBuilderPreviewAsset(value: string): boolean {
  try {
    const u = new URL(value);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return false;
    if (/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))
      return u.pathname.startsWith('/storage/v1/object/public/');
    return (BUILDER_PREVIEW_ASSET_ORIGINS as readonly string[]).includes(
      u.origin
    );
  } catch {
    return false;
  }
}
/** Theme tokens may contain colors, lengths, shadows and typography, never resource loaders. */
function safeThemeTokens(value: unknown): boolean {
  if (typeof value === 'string') {
    if (/[\\:@]|\/\*|\*\//.test(value)) return false;
    const allowed = new Set([
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'oklch',
      'oklab',
      'lab',
      'lch',
      'calc',
      'clamp',
      'min',
      'max',
      'cubic-bezier',
      'steps',
      'linear-gradient',
      'radial-gradient',
      'conic-gradient',
    ]);
    return [...value.matchAll(/([a-z-]+)\s*\(/gi)].every((match) =>
      allowed.has(match[1].toLowerCase())
    );
  }
  if (value && typeof value === 'object')
    return Object.values(value).every(safeThemeTokens);
  return true;
}
export function hasSafeBuilderPreviewAssets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, child]) => {
    if (key === 'theme') return safeThemeTokens(child);
    if (
      ['backgroundImage', 'logo_url', 'image'].includes(key) &&
      typeof child === 'string'
    )
      return isBuilderPreviewAsset(child);
    return hasSafeBuilderPreviewAssets(child);
  });
}

export const builderPreviewProductImagesSchema = z
  .array(
    z.union([z.string(), z.object({ url: z.string().nullable().optional() })])
  )
  .nullable();
