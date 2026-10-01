import { isValidTwitterProfileHandle } from './twitter-profile-handle';

/**
 * Normalizes a social media input (username or URL) into a valid URL.
 * Handles removing leading @ and prepending the correct domain.
 */
export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
  'youtube',
  'linkedin',
  'pinterest',
  'snapchat',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const TWITTER_PROFILE_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);
function normalizeTwitterProfileUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (!TWITTER_PROFILE_HOSTS.has(hostname)) {
      return undefined;
    }

    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 0) {
      return `https://x.com${url.search}${url.hash}`;
    }

    if (pathSegments.length !== 1) {
      return undefined;
    }

    const [handle] = pathSegments;
    if (!handle || !isValidTwitterProfileHandle(handle)) {
      return undefined;
    }

    return `https://x.com/${handle}`;
  } catch {
    return undefined;
  }
}

export function isSocialPlatform(platform: string): platform is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(platform);
}

export function normalizeSocialUrl(
  input: string | undefined,
  platform: SocialPlatform
): string | undefined {
  if (!input?.trim()) return undefined;

  const cleanInput = input.trim();

  if (/^https?:\/\//i.test(cleanInput)) {
    if (platform === 'twitter') {
      return normalizeTwitterProfileUrl(cleanInput) ?? cleanInput;
    }
    return cleanInput;
  }

  // Remove leading @ if present
  const handle = cleanInput.replace(/^@/, '');

  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${handle}`;
    case 'facebook':
      return `https://facebook.com/${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'twitter':
      return `https://x.com/${handle}`;
    case 'snapchat':
      return `https://www.snapchat.com/@${handle}`;
    case 'youtube':
      // YouTube handles usually start with @
      return `https://youtube.com/@${handle}`;
    case 'linkedin':
      // Default to company for merchants, but fallback/support personal 'in/' logic is hard without more context.
      // Defaulting to company page as Baci is B2B2C.
      return `https://linkedin.com/company/${handle}`;
    case 'pinterest':
      return `https://pinterest.com/${handle}`;
    default:
      return `https://${platform}.com/${handle}`;
  }
}
