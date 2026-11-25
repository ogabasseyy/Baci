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

const CANONICAL_WWW_SOCIAL_HOSTS: Partial<
  Record<SocialPlatform, { bare: string; canonical: string }>
> = {
  instagram: { bare: 'instagram.com', canonical: 'www.instagram.com' },
  facebook: { bare: 'facebook.com', canonical: 'www.facebook.com' },
};

function normalizeCanonicalSocialUrl(
  input: string,
  platform: SocialPlatform
): string {
  if (platform === 'twitter') {
    return normalizeTwitterProfileUrl(input) ?? input;
  }

  const hostRule = CANONICAL_WWW_SOCIAL_HOSTS[platform];
  if (!hostRule || /^https?:\/\/[^/?#]+:\d+/i.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (hostname === hostRule.bare || hostname === hostRule.canonical) {
      url.protocol = 'https:';
      url.hostname = hostRule.canonical;
      return url.toString();
    }
  } catch {
    return input;
  }

  return input;
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
    return normalizeCanonicalSocialUrl(cleanInput, platform);
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+|[/?#])/i.test(cleanInput)) {
    return normalizeCanonicalSocialUrl(`https://${cleanInput}`, platform);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(cleanInput)) {
    return undefined;
  }

  // Remove leading @ if present
  const handle = cleanInput.replace(/^@/, '');

  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
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
