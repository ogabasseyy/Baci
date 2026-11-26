const IMAGES_ONBOARDING_PREFIX = '/storage/v1/object/public/images/onboarding/';

/**
 * Verifies that a logo URL points to the caller's own folder in the public
 * Supabase Storage `images` bucket (`images/onboarding/{userId}/...`).
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
    const [ownerId, ...rest] = relativePath.split('/').filter(Boolean);
    return ownerId === userId && rest.length > 0;
  } catch {
    return false;
  }
}
