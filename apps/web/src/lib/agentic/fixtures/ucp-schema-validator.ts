import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

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

// The schemas' $id values are identifiers, not downloadable pages (the
// unversioned URLs return 404), so only the origin appears as a literal.
const ID_ORIGIN = 'https://ucp.dev';

/** Schema references a caller can validate a payload against. */
export const UCP_SCHEMAS = {
  businessProfile: `${ID_ORIGIN}/discovery/profile.json`,
  cart: `${ID_ORIGIN}/schemas/shopping/cart.json`,
  catalogLookupResponse: `${ID_ORIGIN}/schemas/shopping/catalog_lookup.json#/$defs/lookup_response`,
  catalogSearchResponse: `${ID_ORIGIN}/schemas/shopping/catalog_search.json#/$defs/search_response`,
  order: `${ID_ORIGIN}/schemas/shopping/order.json`,
  platformCapability: `${ID_ORIGIN}/schemas/capability.json#/$defs/platform_schema`,
  responseCartMetadata: `${ID_ORIGIN}/schemas/ucp.json#/$defs/response_cart_schema`,
} as const;

export type UcpSchemaRef = (typeof UCP_SCHEMAS)[keyof typeof UCP_SCHEMAS];

interface UcpValidationResult {
  readonly errors: string[];
  readonly valid: boolean;
}

const PROFILE_FILE = 'discovery/profile_schema.json';
// Upstream declares this schema's $id as .../schemas/discovery/profile.json
// while its own $refs ("../schemas/ucp.json") assume it sits one level higher.
// Registering it under the matching base keeps every reference local.
const PROFILE_BASE_URI = `${ID_ORIGIN}/discovery/profile.json`;

export function listUcpSchemaFiles(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.json') ? [path] : [];
    });
  return ['discovery', 'schemas']
    .flatMap((folder) => walk(join(UCP_FIXTURE_DIR, folder)))
    .map((path) => relative(UCP_FIXTURE_DIR, path).split('\\').join('/'))
    .sort();
}

export function readUcpSchemaFile(file: string): unknown {
  return JSON.parse(readFileSync(join(UCP_FIXTURE_DIR, file), 'utf8'));
}

/** Hash of the parsed JSON, so reformatting a vendored file cannot change it. */
export function canonicalJsonSha256(bytes: Buffer | string): string {
  return createHash('sha256')
    .update(JSON.stringify(JSON.parse(bytes.toString())))
    .digest('hex');
}

/** Files a schema references through relative $ref values (fragments dropped). */
export function relativeSchemaRefs(file: string, schema: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const [target] = value.split('#');
        if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          refs.add(posix.normalize(posix.join(posix.dirname(file), target)));
        }
      } else {
        visit(value);
      }
    }
  };
  visit(schema);
  return [...refs].sort();
}

function createAjv(): Ajv2020 {
  // UCP schemas use `required` without `properties` in allOf branches and
  // `properties` without `type` in conditional branches. Both are legal, so
  // the strictRequired and strictTypes lints are off; unknown keywords still
  // fail, apart from the two annotations registered below.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  addFormats(ajv);
  // `ucp_request` marks per-operation request presence ("omit", "optional",
  // "required", or {create, update, complete}). This validator checks RESPONSE
  // payloads, where the schema is read as written and the annotation does not
  // apply. A request validator must resolve it per operation first.
  ajv.addKeyword({ keyword: 'ucp_request' });
  // Capability schemas carry their reverse-domain name in a root `name`.
  ajv.addKeyword({ keyword: 'name' });
  for (const file of listUcpSchemaFiles()) {
    const schema = readUcpSchemaFile(file) as Record<string, unknown>;
    ajv.addSchema(
      file === PROFILE_FILE ? { ...schema, $id: PROFILE_BASE_URI } : schema
    );
  }
  return ajv;
}

let sharedAjv: Ajv2020 | undefined;

function describeError(error: ErrorObject): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`;
}

/** Validates a UCP response payload against a vendored 2026-04-08 schema. */
export function validateUcpDocument(
  schemaRef: UcpSchemaRef,
  document: unknown
): UcpValidationResult {
  sharedAjv ??= createAjv();
  const validate = sharedAjv.getSchema(schemaRef);
  if (!validate) {
    throw new Error(`Unknown UCP schema reference: ${schemaRef}`);
  }
  const valid = validate(document) as boolean;
  return {
    errors: valid ? [] : (validate.errors ?? []).map(describeError),
    valid,
  };
}
