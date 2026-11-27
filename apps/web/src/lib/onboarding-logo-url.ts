const IMAGES_ONBOARDING_PREFIX = '/storage/v1/object/public/images/onboarding/';
const ALLOWED_RASTER_LOGO_EXTENSION = /\.(png|jpe?g|webp)$/i;

/**
 * Verifies that a logo URL points to a raster image inside the caller's own
 * folder in the public Supabase Storage `images` bucket
 * (`images/onboarding/{userId}/...`).
 */
export function isUserScopedOnboardingLogoUrl(
  logoUrl: string,
  userId: string
): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !userId) return false;
  try {
    const allowedOrigin = new URL(supabaseUrl).origin;
    const candidate = new URL(logoUrl);
    if (
      candidate.origin !== allowedOrigin ||
      !candidate.pathname.startsWith(IMAGES_ONBOARDING_PREFIX)
    ) {
      return false;
    }
    const relativePath = candidate.pathname.slice(
      IMAGES_ONBOARDING_PREFIX.length
    );
    const segments = relativePath.split('/').filter(Boolean);
    const [ownerId, ...rest] = segments;
    const filename = rest.at(-1);
    return (
      ownerId === userId &&
      rest.length > 0 &&
      !rest.some((segment) => segment === '.' || segment === '..') &&
      Boolean(filename && ALLOWED_RASTER_LOGO_EXTENSION.test(filename))
    );
  } catch {
    return false;
  }
}
