import { OGABASSEY_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

const OGABASSEY_DOMAIN_IDENTIFIER = new URL(OGABASSEY_URL).hostname;

export function isOgabasseyHomeIdentifier(slug: string): boolean {
  const normalizedSlug = slug.toLowerCase();
  return (
    normalizedSlug === OGABASSEY_TEMPLATE_ID ||
    normalizedSlug === OGABASSEY_DOMAIN_IDENTIFIER
  );
}
