import { OGABASSEY_TEMPLATE_ID } from './templates';

/** Tenant key the snapshot pipeline writes under. Only this tenant has
 *  snapshots; every other slug resolves to null (CDN fallback). Multi-tenant
 *  snapshots would add manifest keys and pass `merchant.slug` at call sites —
 *  current scope is ogabassey-only and every call site is in an
 *  ogabassey-specific file. */
export const OGABASSEY_HOME_HERO_SNAPSHOT_TENANT = OGABASSEY_TEMPLATE_ID;
