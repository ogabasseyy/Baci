import { OGABASSEY_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

export const OGABASSEY_DOMAIN_IDENTIFIER = new URL(OGABASSEY_URL).hostname;

export function isOgabasseyHomeIdentifier(slug: string): boolean {
  const normalizedSlug = slug.toLowerCase();

  return (
    normalizedSlug === OGABASSEY_TEMPLATE_ID ||
    normalizedSlug === OGABASSEY_DOMAIN_IDENTIFIER
  );
}

export function isOgabasseyCanonicalDomainSlug(slug: string): boolean {
  return slug.toLowerCase() === OGABASSEY_DOMAIN_IDENTIFIER;
}

export function getOgabasseyHomePathPrefix(slug: string): string {
  return isOgabasseyCanonicalDomainSlug(slug)
    ? ''
    : `/${OGABASSEY_TEMPLATE_ID}`;
}
