import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UCP_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'ucp-2026-04-08'
);

/** Schema files the closure check starts from (paths inside UCP_FIXTURE_DIR). */
export const UCP_ROOT_SCHEMA_FILES = [
  'discovery/profile_schema.json',
  'schemas/ucp.json',
  'schemas/shopping/catalog_search.json',
  'schemas/shopping/catalog_lookup.json',
  'schemas/shopping/cart.json',
  'schemas/shopping/order.json',
] as const;
