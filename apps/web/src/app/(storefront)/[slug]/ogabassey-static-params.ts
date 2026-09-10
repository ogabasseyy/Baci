import { OGABASSEY_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';

export const OGABASSEY_STATIC_TENANTS = [
  new URL(OGABASSEY_URL).hostname,
  OGABASSEY_TEMPLATE_ID,
] as const;

export function isOgabasseyStaticTenant(slug: string): boolean {
  return OGABASSEY_STATIC_TENANTS.some((tenant) => tenant === slug);
}

export function getOgabasseyStaticParams(): Array<{ slug: string }> {
  return OGABASSEY_STATIC_TENANTS.map((slug) => ({ slug }));
}
